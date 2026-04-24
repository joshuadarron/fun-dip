import type { PipelineInvoker } from "@fundip/rocketride-client";
import type { ChatPipelineInput } from "@fundip/shared-types";
import { Router } from "express";
import { z } from "zod";

/**
 * POST /api/chat
 *
 * The single user-facing chat endpoint. Accepts a `ChatPipelineInput`,
 * zod-validates it, and forwards to `invoker.runChatPipeline`. Returns
 * the typed `ChatPipelineOutput` JSON.
 *
 * Mounted by the app under the `// --- chat ---` fence in
 * `apps/api/src/app.ts`. Intentionally NO streaming surface here: the
 * pipeline.pipe response sink is `response_answers`, which the invoker
 * reads as a single JSON document.
 */

const selectionSchema = z
  .object({
    type: z.enum(["program", "submission", "match"]),
    id: z.string().min(1),
  })
  .strict();

const inputSchema = z
  .object({
    user_id: z.string().min(1),
    profile_id: z.string().min(1),
    conversation_id: z.string().min(1),
    current_page: z.enum(["dashboard", "profile", "programs", "submissions"]),
    current_selection: selectionSchema.nullable(),
    message: z.string().min(1),
  })
  .strict();

export function createChatRouter(opts: { invoker: PipelineInvoker }): Router {
  const router = Router();

  router.post("/api/chat", async (req, res) => {
    const parsed = inputSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid input", issues: parsed.error.issues });
      return;
    }
    const input: ChatPipelineInput = {
      user_id: parsed.data.user_id,
      profile_id: parsed.data.profile_id,
      conversation_id: parsed.data.conversation_id,
      current_page: parsed.data.current_page,
      current_selection: parsed.data.current_selection,
      message: parsed.data.message,
    };
    try {
      const output = await opts.invoker.runChatPipeline(input);
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
