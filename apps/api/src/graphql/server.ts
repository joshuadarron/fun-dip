import { Router } from "express";
import { z } from "zod";
import type { Repositories } from "../ghost/repos.js";
import { profileResolvers, type GraphQLContext, type ProfilePatch } from "./resolvers.js";
import { PROFILE_SCHEMA_SDL } from "./schema.js";

/**
 * Minimal GraphQL-shaped endpoint.
 *
 * ASSUMPTION: The Wondergraph adapter SDK is not wired into this repo
 * yet. When it lands, the `profileResolvers` object can plug into the
 * Wondergraph server directly (same `(parent, args, ctx)` shape). Until
 * then this router exposes a JSON surface at `/graphql` with two shapes:
 *
 * 1. `{ operationName: "profile", variables: { id } }`, the "structured"
 *    form, parsed by name. This is what our tests and internal callers
 *    use. It avoids bringing a full GraphQL parser into the dep tree.
 * 2. `{ query: "..." }`, responded to with a hint that the full parser
 *    is not wired yet. Prevents silent empty responses during dev.
 *
 * The `/graphql/schema` route returns the SDL so tooling can consume it.
 */
export function createGraphQLRouter(opts: { repos: Repositories }): Router {
  const router = Router();
  const ctx: GraphQLContext = { repos: opts.repos };

  router.get("/graphql/schema", (_req, res) => {
    res.type("application/graphql").send(PROFILE_SCHEMA_SDL);
  });

  router.post("/graphql", async (req, res) => {
    try {
      const result = await dispatch(req.body, ctx);
      res.status(200).json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : "unknown error";
      res.status(400).json({ data: null, errors: [{ message }] });
    }
  });

  return router;
}

const queryOp = z.enum(["profile", "profileByUser", "Profile", "ProgramMatches", "Submissions"]);
const mutationOp = z.enum(["updateProfile", "UpdateProfile"]);
const operation = z.union([queryOp, mutationOp]);

const bodySchema = z.union([
  z.object({
    operationName: operation,
    variables: z.record(z.string(), z.unknown()).optional(),
  }),
  z.object({
    query: z.string(),
    variables: z.record(z.string(), z.unknown()).optional(),
    operationName: z.string().nullable().optional(),
  }),
]);

type StructuredBody = Extract<
  z.infer<typeof bodySchema>,
  { operationName: unknown; query?: never }
>;

/**
 * Best-effort parse of the operation name out of a raw GraphQL document.
 * Used when the client did not send `operationName` as a sibling field.
 */
function extractOperationName(query: string): string | null {
  const match = /\b(?:query|mutation)\s+([A-Za-z_][A-Za-z0-9_]*)/.exec(query);
  return match?.[1] ?? null;
}

/**
 * Map the conventions we use in the frontend (PascalCase named operations)
 * onto the canonical backend names (camelCase).
 */
function normalizeOperationName(name: string): string {
  switch (name) {
    case "Profile":
      return "profile";
    case "UpdateProfile":
      return "updateProfile";
    case "ProgramMatches":
      return "programMatches";
    case "Submissions":
      return "submissions";
    default:
      return name;
  }
}

async function dispatch(
  body: unknown,
  ctx: GraphQLContext,
): Promise<{ data: unknown; errors?: Array<{ message: string }> }> {
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return { data: null, errors: [{ message: "invalid GraphQL request body" }] };
  }
  const payload = parsed.data;

  // Resolve operation name from whichever body shape the caller sent.
  let rawName: string | null = null;
  if ("operationName" in payload && typeof payload.operationName === "string") {
    rawName = payload.operationName;
  } else if ("query" in payload && typeof payload.query === "string") {
    rawName = extractOperationName(payload.query);
  }
  if (!rawName) {
    return { data: null, errors: [{ message: "missing operationName" }] };
  }
  const name = normalizeOperationName(rawName);
  const vars = (payload as StructuredBody).variables ?? {};

  if (name === "profile") {
    const args = z.object({ id: z.string() }).parse(vars);
    const data = await profileResolvers.Query.profile(null, args, ctx);
    return { data: { profile: data, profileSummary: null } };
  }
  if (name === "profileByUser") {
    const args = z.object({ user_id: z.string() }).parse(vars);
    const data = await profileResolvers.Query.profileByUser(null, args, ctx);
    return { data: { profileByUser: data } };
  }
  if (name === "programMatches") {
    const args = z.object({ profileId: z.string() }).parse(vars);
    const rows = await ctx.repos.matches.listForProfile(args.profileId);
    const hydrated = await Promise.all(
      rows.map(async (m) => ({
        ...m,
        program: await ctx.repos.programs
          .list()
          .then((all) => all.find((p) => p.id === m.program_id) ?? null),
      })),
    );
    return { data: { programMatches: hydrated } };
  }
  if (name === "submissions") {
    const args = z.object({ profileId: z.string() }).parse(vars);
    const rows = await ctx.repos.submissions.listForProfile(args.profileId);
    const programs = await ctx.repos.programs.list();
    const hydrated = rows.map((s) => ({
      ...s,
      program: programs.find((p) => p.id === s.program_id) ?? null,
    }));
    return { data: { submissions: hydrated } };
  }
  if (name === "updateProfile") {
    const patchSchema = z
      .object({
        startup_name: z.string().optional(),
        stage: z.enum(["idea", "pre_seed", "seed", "series_a", "series_b_plus"]).optional(),
        location: z.string().nullable().optional(),
        market: z.string().nullable().optional(),
        goals: z.array(z.string()).optional(),
        looking_for: z
          .array(z.enum(["increase_mrr", "technology_pea", "investors", "incubator"]))
          .optional(),
        narrative: z.string().optional(),
      })
      .strict();
    const args = z.object({ id: z.string(), patch: patchSchema }).parse(vars) as {
      id: string;
      patch: ProfilePatch;
    };
    const data = await profileResolvers.Mutation.updateProfile(null, args, ctx);
    return { data: { updateProfile: data } };
  }

  return { data: null, errors: [{ message: `unknown operationName: ${name}` }] };
}
