import {
  CALLBACK_PATHS,
  type MatchesReadyPayload,
  type SubmissionNeedsInputPayload,
  type SubmissionSubmittedPayload,
} from "@fundip/shared-types";
import { Router, raw } from "express";
import { z } from "zod";
import { hmacCallbackMiddleware } from "./verify.js";

const matchesReadySchema = z.object({
  profile_id: z.string(),
  match_count: z.number().int().nonnegative(),
  max_tier: z.enum(["hot", "warm", "cold"]),
}) satisfies z.ZodType<MatchesReadyPayload>;

const missingFieldSchema = z.object({
  field_name: z.string(),
  description: z.string(),
  type: z.enum(["string", "text", "number", "boolean", "enum", "file"]),
  enum_values: z.array(z.string()).optional(),
});

const submissionNeedsInputSchema = z.object({
  submission_id: z.string(),
  profile_id: z.string(),
  program_id: z.string(),
  missing_fields: z.array(missingFieldSchema),
}) satisfies z.ZodType<SubmissionNeedsInputPayload>;

const submissionSubmittedSchema = z.object({
  submission_id: z.string(),
  profile_id: z.string(),
  program_id: z.string(),
  confirmation_ref: z.string().nullable(),
}) satisfies z.ZodType<SubmissionSubmittedPayload>;

export interface CallbackHandlers {
  onMatchesReady(payload: MatchesReadyPayload): Promise<void> | void;
  onSubmissionNeedsInput(payload: SubmissionNeedsInputPayload): Promise<void> | void;
  onSubmissionSubmitted(payload: SubmissionSubmittedPayload): Promise<void> | void;
}

export function createCallbackRouter(opts: { secret: string; handlers: CallbackHandlers }): Router {
  const { secret, handlers } = opts;
  const router = Router();
  const parseRaw = raw({ type: "application/json", limit: "256kb" });
  const verify = hmacCallbackMiddleware(secret);

  router.post(CALLBACK_PATHS.matches_ready, parseRaw, verify, async (req, res) => {
    const parsed = matchesReadySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid payload", issues: parsed.error.issues });
      return;
    }
    await handlers.onMatchesReady(parsed.data);
    res.status(202).json({ status: "accepted" });
  });

  router.post(CALLBACK_PATHS.submission_needs_input, parseRaw, verify, async (req, res) => {
    const parsed = submissionNeedsInputSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid payload", issues: parsed.error.issues });
      return;
    }
    await handlers.onSubmissionNeedsInput(parsed.data);
    res.status(202).json({ status: "accepted" });
  });

  router.post(CALLBACK_PATHS.submission_submitted, parseRaw, verify, async (req, res) => {
    const parsed = submissionSubmittedSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid payload", issues: parsed.error.issues });
      return;
    }
    await handlers.onSubmissionSubmitted(parsed.data);
    res.status(202).json({ status: "accepted" });
  });

  return router;
}
