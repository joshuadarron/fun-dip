import type { PipelineInvoker } from "@fundip/rocketride-client";
import type { ProfilePipelineInput } from "@fundip/shared-types";
import { Router } from "express";
import { z } from "zod";

const factSchema = z.object({
  field: z.string().min(1),
  value: z.unknown(),
  source: z.enum(["chat", "import", "inferred"]),
});

const inputSchema = z
  .object({
    profile_id: z.string().min(1),
    mode: z.enum(["create", "update", "read"]),
    facts: z.array(factSchema).optional(),
    context: z.string().optional(),
  })
  .strict();

/**
 * POST /api/profile/invoke
 *
 * Thin wrapper around `invoker.runProfilePipeline`. Zod-validates input
 * and returns the pipeline's JSON output. Not user-facing: used by
 * bulk-import scripts and, in Phase 7, by the chat pipeline's
 * profile-as-tool wrapper.
 */
export function createProfileRouter(opts: { invoker: PipelineInvoker }): Router {
  const router = Router();

  router.post("/api/profile/invoke", async (req, res) => {
    const parsed = inputSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid input", issues: parsed.error.issues });
      return;
    }
    try {
      // parsed.data narrows to the zod-inferred type where `value: unknown`
      // is optional-on-parse. ProfilePipelineInput keeps `value` required;
      // normalizing facts here preserves that contract.
      const normalized: ProfilePipelineInput = {
        profile_id: parsed.data.profile_id,
        mode: parsed.data.mode,
        ...(parsed.data.facts
          ? {
              facts: parsed.data.facts.map((f) => ({
                field: f.field,
                value: f.value,
                source: f.source,
              })),
            }
          : {}),
        ...(parsed.data.context !== undefined ? { context: parsed.data.context } : {}),
      };
      const output = await opts.invoker.runProfilePipeline(normalized);
      res.status(200).json(output);
    } catch (err) {
      const body =
        err && typeof err === "object" && "body" in err
          ? (err as { body: unknown }).body
          : {
              status: "error",
              error: err instanceof Error ? err.message : "unknown",
              retryable: true,
            };
      res.status(502).json(body);
    }
  });

  return router;
}
