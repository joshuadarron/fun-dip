import { escapeHtml, pageShell, plainText, renderButton } from "./shared.js";
import type { RenderedEmail } from "./digest.js";

export interface MissingInfoFieldView {
  field_name: string;
  description: string;
  type: string;
}

export interface MissingInfoEmailProps {
  startup_name: string;
  program_name: string;
  program_provider: string;
  missing_fields: MissingInfoFieldView[];
  /**
   * Absolute URL to the in-app Profile page where the user fills the
   * gaps. No token is needed: the user will authenticate in-app via the
   * existing Google OAuth session.
   */
  profile_url: string;
}

/**
 * Missing info email triggered by the `submission_needs_input` callback.
 * Lists the gaps the submissions pipeline could not infer from the
 * profile and points the user back to the Profile page.
 */
export function renderMissingInfoEmail(props: MissingInfoEmailProps): RenderedEmail {
  const subject = `${props.program_name}: a few more details needed`;

  const gapList = props.missing_fields
    .map(
      (f) =>
        `<li style="margin-bottom:6px;"><strong>${escapeHtml(f.field_name)}</strong> (${escapeHtml(f.type)}): ${escapeHtml(f.description)}</li>`,
    )
    .join("\n");

  const body = `
    <h1 style="font-family:Arial,Helvetica,sans-serif;font-size:22px;font-weight:700;color:#111827;margin:0 0 8px 0;">
      A few more details for ${escapeHtml(props.program_name)}
    </h1>
    <p style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#374151;margin:0 0 12px 0;">
      ${escapeHtml(props.program_provider)} requires information your Fundip profile does not yet have. Add it on your Profile page and we will resume the application.
    </p>
    <ul style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#111827;margin:0 0 16px 18px;padding:0;">
      ${gapList}
    </ul>
    ${renderButton(props.profile_url, "Open profile")}
    <p style="font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#6b7280;margin-top:32px;">
      You are receiving this because Fundip is preparing an application for ${escapeHtml(props.startup_name)}.
    </p>
  `.trim();

  const html = pageShell(subject, body);

  const textLines = [
    `A few more details needed for ${props.program_name} (${props.program_provider}).`,
    "",
    "Missing fields:",
    ...props.missing_fields.map((f) => `- ${f.field_name} (${f.type}): ${f.description}`),
    "",
    `Open your profile: ${props.profile_url}`,
  ];
  const text = plainText(textLines);

  return { subject, html, text };
}
