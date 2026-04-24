import { escapeHtml, pageShell, plainText, renderButton } from "./shared.js";
import type { RenderedEmail } from "./digest.js";

export interface SubmissionConfirmedEmailProps {
  startup_name: string;
  program_name: string;
  program_provider: string;
  /** Reference id returned by the program, if any. */
  confirmation_ref: string | null;
  /** Absolute URL back to the Submissions page in the app. */
  submissions_url: string;
}

/**
 * Confirmation email fired on the `submission_submitted` callback.
 */
export function renderSubmissionConfirmedEmail(
  props: SubmissionConfirmedEmailProps,
): RenderedEmail {
  const subject = `Application submitted: ${props.program_name}`;

  const refLine = props.confirmation_ref
    ? `<p style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#111827;margin:0 0 8px 0;">Reference: <code style="background-color:#f3f4f6;padding:2px 6px;border-radius:4px;">${escapeHtml(props.confirmation_ref)}</code></p>`
    : `<p style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#374151;margin:0 0 8px 0;">No reference id returned by the program. We will track the response when it arrives.</p>`;

  const body = `
    <h1 style="font-family:Arial,Helvetica,sans-serif;font-size:22px;font-weight:700;color:#111827;margin:0 0 8px 0;">
      Application submitted to ${escapeHtml(props.program_name)}
    </h1>
    <p style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#374151;margin:0 0 12px 0;">
      ${escapeHtml(props.program_provider)} received your application for ${escapeHtml(props.startup_name)}.
    </p>
    ${refLine}
    ${renderButton(props.submissions_url, "View submission")}
    <p style="font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#6b7280;margin-top:32px;">
      Replies to this address are not monitored. Track responses on the Submissions page.
    </p>
  `.trim();

  const html = pageShell(subject, body);

  const textLines = [
    `Application submitted to ${props.program_name} (${props.program_provider}).`,
    `Startup: ${props.startup_name}`,
    props.confirmation_ref ? `Reference: ${props.confirmation_ref}` : "No reference id returned.",
    "",
    `View submission: ${props.submissions_url}`,
  ];
  const text = plainText(textLines);

  return { subject, html, text };
}
