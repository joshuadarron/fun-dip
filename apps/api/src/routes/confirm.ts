import { Router } from "express";
import { z } from "zod";
import { verifyDeepLinkToken } from "../deep-links/tokens.js";
import { escapeHtml } from "../email/templates/shared.js";
import { requireAuth } from "./auth.js";
import type { PipelineInvoker } from "@fundip/rocketride-client";
import type { SubmissionsPipelineInput } from "@fundip/shared-types";

/**
 * Email deep-link confirmation page.
 *
 * GET /confirm
 *   Verifies the signed token. On success, renders a minimal HTML page
 *   with a POST form to `/confirm/submit` (same path with the
 *   submission id baked in via hidden fields). The POST handler
 *   requires BOTH the signed token AND an authenticated session, per
 *   `.claude/docs/ARCHITECTURE.md` rule 13.
 *
 * POST /confirm/submit
 *   `requireAuth` middleware checks the session cookie. The handler
 *   re-verifies the deep-link token (defense in depth) and forwards to
 *   the submissions pipeline with `action=submit`.
 */
export interface ConfirmRouterOptions {
  signingKey: string;
  invoker?: PipelineInvoker;
  /** Used by `requireAuth` for the POST handler. Same key as deep links. */
  sessionSigningKey: string;
}

const querySchema = z.object({
  token: z.string().min(1),
  submission: z.string().min(1),
});

const postBodySchema = z.object({
  token: z.string().min(1),
  submission: z.string().min(1),
  profile_id: z.string().min(1),
  program_id: z.string().min(1),
});

function htmlPage(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(title)}</title>
<style>
  body{font-family:Arial,Helvetica,sans-serif;color:#111827;background:#f9fafb;margin:0;padding:24px;}
  .card{max-width:520px;margin:32px auto;padding:24px;background:#fff;border-radius:8px;}
  h1{margin:0 0 12px 0;font-size:20px;}
  button{padding:10px 18px;border-radius:6px;border:0;background:#1f2937;color:#fff;font-size:14px;cursor:pointer;}
  .err{color:#b91c1c;}
</style>
</head>
<body><div class="card">${body}</div></body>
</html>`;
}

export function createConfirmRouter(opts: ConfirmRouterOptions): Router {
  const router = Router();

  router.get("/confirm", (req, res) => {
    const parsed = querySchema.safeParse(req.query);
    if (!parsed.success) {
      res
        .status(400)
        .type("text/html")
        .send(htmlPage("Invalid link", '<h1 class="err">Invalid confirmation link</h1>'));
      return;
    }
    const verified = verifyDeepLinkToken(parsed.data.token, opts.signingKey);
    if (!verified.ok) {
      const status = verified.reason === "expired" ? 401 : 400;
      const message =
        verified.reason === "expired" ? "This link has expired." : "This link is not valid.";
      res
        .status(status)
        .type("text/html")
        .send(htmlPage("Link error", `<h1 class="err">${escapeHtml(message)}</h1>`));
      return;
    }
    if (verified.payload.purpose !== "submission_confirm") {
      res
        .status(400)
        .type("text/html")
        .send(htmlPage("Link error", '<h1 class="err">Invalid token purpose.</h1>'));
      return;
    }

    const submissionId = parsed.data.submission;
    const tokenStr = parsed.data.token;
    const profileId = verified.payload.profile_id ?? "";
    const body = `
      <h1>Confirm submission</h1>
      <p>You are signed in via Fundip and ready to submit your application. The link below carries a short-lived signed token; both the token and your active session are checked when you submit.</p>
      <form method="POST" action="/confirm/submit">
        <input type="hidden" name="token" value="${escapeHtml(tokenStr)}" />
        <input type="hidden" name="submission" value="${escapeHtml(submissionId)}" />
        <input type="hidden" name="profile_id" value="${escapeHtml(profileId)}" />
        <input type="hidden" name="program_id" value="" />
        <p><em>Note: program_id is filled by the in-app submission flow once you confirm.</em></p>
        <button type="submit">Submit application</button>
      </form>
    `;
    res.status(200).type("text/html").send(htmlPage("Confirm submission", body));
  });

  router.post(
    "/confirm/submit",
    requireAuth({ signingKey: opts.sessionSigningKey }),
    async (req, res) => {
      const parsed = postBodySchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: "invalid body", issues: parsed.error.issues });
        return;
      }
      const verified = verifyDeepLinkToken(parsed.data.token, opts.signingKey);
      if (!verified.ok) {
        res.status(verified.reason === "expired" ? 401 : 400).json({
          error: "invalid token",
          reason: verified.reason,
        });
        return;
      }
      if (!opts.invoker) {
        res.status(503).json({ error: "submissions pipeline not configured" });
        return;
      }
      try {
        const input: SubmissionsPipelineInput = {
          profile_id: parsed.data.profile_id,
          program_id: parsed.data.program_id,
          submission_id: parsed.data.submission,
          action: "submit",
        };
        const output = await opts.invoker.runSubmissionsPipeline(input);
        res.status(200).json(output);
      } catch (err) {
        const message = err instanceof Error ? err.message : "unknown";
        res.status(502).json({ status: "error", error: message, retryable: true });
      }
    },
  );

  return router;
}
