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

const queryOp = z.enum(["profile", "profileByUser"]);
const mutationOp = z.enum(["updateProfile"]);
const operation = z.union([queryOp, mutationOp]);

const bodySchema = z.union([
  z.object({
    operationName: operation,
    variables: z.record(z.string(), z.unknown()).optional(),
  }),
  z.object({ query: z.string() }),
]);

type StructuredBody = Extract<z.infer<typeof bodySchema>, { operationName: unknown }>;

async function dispatch(
  body: unknown,
  ctx: GraphQLContext,
): Promise<{ data: unknown; errors?: Array<{ message: string }> }> {
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return { data: null, errors: [{ message: "invalid GraphQL request body" }] };
  }
  const payload = parsed.data;
  if ("query" in payload) {
    return {
      data: null,
      errors: [
        {
          message:
            "Raw GraphQL query strings are not parsed by this endpoint yet. " +
            "Send { operationName, variables } instead. See apps/api/src/graphql/server.ts.",
        },
      ],
    };
  }

  const call = payload as StructuredBody;
  const vars = call.variables ?? {};

  if (call.operationName === "profile") {
    const args = z.object({ id: z.string() }).parse(vars);
    const data = await profileResolvers.Query.profile(null, args, ctx);
    return { data: { profile: data } };
  }
  if (call.operationName === "profileByUser") {
    const args = z.object({ user_id: z.string() }).parse(vars);
    const data = await profileResolvers.Query.profileByUser(null, args, ctx);
    return { data: { profileByUser: data } };
  }
  if (call.operationName === "updateProfile") {
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

  return { data: null, errors: [{ message: `unknown operationName` }] };
}
