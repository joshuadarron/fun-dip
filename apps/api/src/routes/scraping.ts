import type { PipelineInvoker } from "@fundip/rocketride-client";
import type { ScrapingPipelineInput } from "@fundip/shared-types";
import { Router } from "express";
import { z } from "zod";

/**
 * Zod schema for the scraping pipeline input, modeling the discriminated
 * union in `@fundip/shared-types`. `full_scrape` allows an optional
 * `source_urls` array; `match` requires `profile_id` and accepts an
 * optional `emit_callback` flag that controls whether the pipeline emits
 * the `matches_ready` HTTP callback (default true for cron, false when
 * chat invokes via Phase 7's tool wrapper).
 */
const fullScrapeSchema = z
  .object({
    mode: z.literal("full_scrape"),
    source_urls: z.array(z.string().url()).optional(),
  })
  .strict();

const matchSchema = z
  .object({
    mode: z.literal("match"),
    profile_id: z.string().min(1),
    emit_callback: z.boolean().optional(),
  })
  .strict();

const inputSchema = z.discriminatedUnion("mode", [fullScrapeSchema, matchSchema]);

/**
 * POST /api/scraping/invoke
 *
 * Thin wrapper around `invoker.runScrapingPipeline`. Zod-validates input
 * against the discriminated union, forwards to the pipeline, and returns
 * the typed JSON output. Callers:
 *
 * - Phase 8 app-layer cron: fires `full_scrape` on Sundays, then one
 *   `match` per active profile with `emit_callback: true`.
 * - Phase 7 chat pipeline tool wrapper: always sends `mode=match` with
 *   `emit_callback: false` (the reply path is synchronous, no email).
 *
 * This route simply honors whatever the caller sends; enforcement of the
 * "chat may only call match" rule lives on the chat side.
 */
export function createScrapingRouter(opts: { invoker: PipelineInvoker }): Router {
  const router = Router();

  router.post("/api/scraping/invoke", async (req, res) => {
    const parsed = inputSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid input", issues: parsed.error.issues });
      return;
    }
    // Normalize to the exact ScrapingPipelineInput shape. Zod's inferred
    // type widens `emit_callback` and `source_urls` to optional, which
    // matches the contract, but we drop undefined keys before forwarding
    // so the pipeline receives a stable payload.
    const input: ScrapingPipelineInput =
      parsed.data.mode === "full_scrape"
        ? {
            mode: "full_scrape",
            ...(parsed.data.source_urls ? { source_urls: parsed.data.source_urls } : {}),
          }
        : {
            mode: "match",
            profile_id: parsed.data.profile_id,
            ...(parsed.data.emit_callback !== undefined
              ? { emit_callback: parsed.data.emit_callback }
              : {}),
          };

    try {
      const output = await opts.invoker.runScrapingPipeline(input);
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
