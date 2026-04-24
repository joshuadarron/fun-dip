import type { PipelineInvoker } from "@fundip/rocketride-client";
import type { SubmissionsPipelineInput } from "@fundip/shared-types";
import { Router } from "express";
import { z } from "zod";

/**
 * Three thin wrappers around `invoker.runSubmissionsPipeline`, one per
 * entry point used by the UI and the email deep-link flow:
 *
 * - POST /api/submissions/prefill
 *     Kick off a brand-new submission (or revisit an existing one for
 *     the same profile/program pair) with action=prefill_only.
 * - POST /api/submissions/:id/resume
 *     Re-invoke prefill_only against an existing submission with newly
 *     provided answers merged into provided_data.
 * - POST /api/submissions/:id/submit
 *     Trigger the actual submission with action=submit. In Phase 8 this
 *     will require an authenticated session; for now it is open so the
 *     plumbing works end-to-end.
 */

const prefillSchema = z
  .object({
    profile_id: z.string().min(1),
    program_id: z.string().min(1),
    submission_id: z.string().min(1).optional(),
    provided_data: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

const resumeSchema = z
  .object({
    profile_id: z.string().min(1),
    program_id: z.string().min(1),
    provided_data: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

const submitSchema = z
  .object({
    profile_id: z.string().min(1),
    program_id: z.string().min(1),
    provided_data: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

function toErrorBody(err: unknown): { status: number; body: unknown } {
  if (err && typeof err === "object" && "body" in err) {
    return { status: 502, body: (err as { body: unknown }).body };
  }
  const message = err instanceof Error ? err.message : "unknown";
  return {
    status: 502,
    body: { status: "error", error: message, retryable: true },
  };
}

export function createSubmissionsRouter(opts: { invoker: PipelineInvoker }): Router {
  const router = Router();

  router.post("/api/submissions/prefill", async (req, res) => {
    const parsed = prefillSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid input", issues: parsed.error.issues });
      return;
    }
    try {
      const input: SubmissionsPipelineInput = {
        profile_id: parsed.data.profile_id,
        program_id: parsed.data.program_id,
        action: "prefill_only",
        ...(parsed.data.submission_id ? { submission_id: parsed.data.submission_id } : {}),
        ...(parsed.data.provided_data ? { provided_data: parsed.data.provided_data } : {}),
      };
      const output = await opts.invoker.runSubmissionsPipeline(input);
      res.status(200).json(output);
    } catch (err) {
      const { status, body } = toErrorBody(err);
      res.status(status).json(body);
    }
  });

  router.post("/api/submissions/:id/resume", async (req, res) => {
    const submissionId = req.params.id;
    if (!submissionId) {
      res.status(400).json({ error: "submission id required" });
      return;
    }
    const parsed = resumeSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid input", issues: parsed.error.issues });
      return;
    }
    try {
      const input: SubmissionsPipelineInput = {
        profile_id: parsed.data.profile_id,
        program_id: parsed.data.program_id,
        submission_id: submissionId,
        action: "prefill_only",
        ...(parsed.data.provided_data ? { provided_data: parsed.data.provided_data } : {}),
      };
      const output = await opts.invoker.runSubmissionsPipeline(input);
      res.status(200).json(output);
    } catch (err) {
      const { status, body } = toErrorBody(err);
      res.status(status).json(body);
    }
  });

  // TODO(phase8): require auth. This route will back the authenticated
  // deep-link confirmation page, so it must verify a valid session before
  // invoking the pipeline. Structure the handler so an auth middleware
  // can slot in without changing the response shape.
  router.post("/api/submissions/:id/submit", async (req, res) => {
    const submissionId = req.params.id;
    if (!submissionId) {
      res.status(400).json({ error: "submission id required" });
      return;
    }
    const parsed = submitSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid input", issues: parsed.error.issues });
      return;
    }
    try {
      const input: SubmissionsPipelineInput = {
        profile_id: parsed.data.profile_id,
        program_id: parsed.data.program_id,
        submission_id: submissionId,
        action: "submit",
        ...(parsed.data.provided_data ? { provided_data: parsed.data.provided_data } : {}),
      };
      const output = await opts.invoker.runSubmissionsPipeline(input);
      res.status(200).json(output);
    } catch (err) {
      const { status, body } = toErrorBody(err);
      res.status(status).json(body);
    }
  });

  return router;
}
