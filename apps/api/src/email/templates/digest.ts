import {
  escapeHtml,
  pageShell,
  plainText,
  renderButton,
  renderScoreMeter,
  renderTierBadge,
} from "./shared.js";

/**
 * Local-only props for the weekly digest. Not added to `@fundip/shared-types`
 * because the email layer is the only consumer; if a future surface (e.g.
 * a preview page) needs the same shape, lift this then.
 */
export interface DigestMatchView {
  program_name: string;
  program_provider: string;
  requirements_summary: string;
  /** 3 to 5 sentence positioning summary written by scraping pipeline. */
  positioning_summary: string;
  /** 0 to 100 fit score. */
  score: number;
  tier: "hot" | "warm" | "cold";
  /** Absolute URL to the deep-link confirmation page (token already baked in). */
  confirm_url: string;
}

export interface DigestEmailProps {
  startup_name: string;
  matches: DigestMatchView[];
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

function renderMatchSection(match: DigestMatchView): string {
  return `
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;margin-top:24px;border-top:1px solid #e5e7eb;">
      <tr>
        <td style="padding-top:16px;">
          <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;">
            <tr>
              <td style="font-family:Arial,Helvetica,sans-serif;font-size:18px;font-weight:700;color:#111827;">
                ${escapeHtml(match.program_name)}
              </td>
              <td align="right">${renderTierBadge(match.tier)}</td>
            </tr>
          </table>
          <div style="font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#6b7280;margin-top:2px;">
            ${escapeHtml(match.program_provider)}
          </div>
          <div style="margin-top:12px;">${renderScoreMeter(match.score)}</div>
          <div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#111827;margin-top:16px;">
            <strong>Requirements:</strong> ${escapeHtml(match.requirements_summary)}
          </div>
          <div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#111827;margin-top:12px;">
            <strong>How you fit:</strong> ${escapeHtml(match.positioning_summary)}
          </div>
          ${renderButton(match.confirm_url, "Review and apply")}
        </td>
      </tr>
    </table>
  `.trim();
}

/**
 * Weekly match digest email. One section per surfaced match, with score
 * meter, tier badge, requirements, positioning summary, and a deep-link
 * button. The button URL must already carry the signed deep-link token.
 */
export function renderDigestEmail(props: DigestEmailProps): RenderedEmail {
  const matchCount = props.matches.length;
  const subject = `Fundip weekly digest: ${String(matchCount)} new ${
    matchCount === 1 ? "match" : "matches"
  } for ${props.startup_name}`;

  const header = `
    <h1 style="font-family:Arial,Helvetica,sans-serif;font-size:22px;font-weight:700;color:#111827;margin:0 0 8px 0;">
      This week, ${escapeHtml(String(matchCount))} new ${matchCount === 1 ? "program" : "programs"} for ${escapeHtml(props.startup_name)}
    </h1>
    <p style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#374151;margin:0 0 8px 0;">
      Each match below shows the program requirements, your positioning, and a fit score. Click through to review and apply.
    </p>
  `.trim();

  const sections = props.matches.map(renderMatchSection).join("\n");

  const footer = `
    <p style="font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#6b7280;margin-top:32px;">
      You are receiving this because you have an active Fundip profile. Replies are not monitored.
    </p>
  `.trim();

  const html = pageShell(subject, `${header}${sections}${footer}`);

  const textLines: string[] = [
    `Fundip weekly digest for ${props.startup_name}`,
    `${String(matchCount)} new ${matchCount === 1 ? "match" : "matches"} this week.`,
    "",
  ];
  for (const m of props.matches) {
    textLines.push(`* ${m.program_name} (${m.program_provider})`);
    textLines.push(`  Score: ${String(Math.round(m.score))}/100, tier: ${m.tier}`);
    textLines.push(`  Requirements: ${m.requirements_summary}`);
    textLines.push(`  How you fit: ${m.positioning_summary}`);
    textLines.push(`  Review and apply: ${m.confirm_url}`);
    textLines.push("");
  }
  const text = plainText(textLines);

  return { subject, html, text };
}
