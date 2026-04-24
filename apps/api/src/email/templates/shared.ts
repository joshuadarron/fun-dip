/**
 * Shared email rendering helpers. Tables-first HTML, inline styles only.
 * No em-dashes, ever (codebase convention).
 *
 * These helpers stay private to the email layer; if a piece of HTML is
 * reused outside templates, lift it then.
 */

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Plain-text fallback. Strips a small set of inline tags. Not a full
 * HTML-to-text engine; we render text directly in each template instead.
 */
export function plainText(lines: string[]): string {
  return lines.filter((l) => l.length > 0).join("\n");
}

/**
 * 0 to 100 score meter rendered as a fixed-width 200px bar with a filled
 * inner segment. Email clients widely support inline width percentages,
 * but Outlook quirks around percentage widths inside table cells make
 * pixel widths the safe choice.
 */
export function renderScoreMeter(score: number): string {
  const clamped = Math.max(0, Math.min(100, Math.round(score)));
  const fillPx = Math.round((clamped / 100) * 200);
  const color = clamped >= 75 ? "#16a34a" : clamped >= 40 ? "#ca8a04" : "#9ca3af";
  return `
    <table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
      <tr>
        <td style="width:200px;height:10px;background-color:#e5e7eb;border-radius:5px;">
          <div style="width:${String(fillPx)}px;height:10px;background-color:${color};border-radius:5px;"></div>
        </td>
        <td style="padding-left:8px;font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#374151;">${String(clamped)}/100</td>
      </tr>
    </table>
  `.trim();
}

export function renderTierBadge(tier: "hot" | "warm" | "cold"): string {
  const palette: Record<"hot" | "warm" | "cold", { bg: string; fg: string; label: string }> = {
    hot: { bg: "#dcfce7", fg: "#166534", label: "Hot" },
    warm: { bg: "#fef3c7", fg: "#92400e", label: "Warm" },
    cold: { bg: "#e5e7eb", fg: "#374151", label: "Cold" },
  };
  const p = palette[tier];
  return `<span style="display:inline-block;padding:2px 8px;border-radius:9999px;background-color:${p.bg};color:${p.fg};font-family:Arial,Helvetica,sans-serif;font-size:12px;font-weight:600;">${p.label}</span>`;
}

export function renderButton(href: string, label: string): string {
  return `
    <table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:12px 0;">
      <tr>
        <td style="background-color:#1f2937;border-radius:6px;">
          <a href="${escapeHtml(href)}" style="display:inline-block;padding:10px 18px;color:#ffffff;text-decoration:none;font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:600;">${escapeHtml(label)}</a>
        </td>
      </tr>
    </table>
  `.trim();
}

export function pageShell(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(title)}</title>
</head>
<body style="margin:0;padding:0;background-color:#f9fafb;font-family:Arial,Helvetica,sans-serif;color:#111827;">
<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;">
  <tr>
    <td align="center" style="padding:24px;">
      <table role="presentation" cellpadding="0" cellspacing="0" width="600" style="border-collapse:collapse;background-color:#ffffff;border-radius:8px;">
        <tr>
          <td style="padding:24px;">
            ${body}
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;
}
