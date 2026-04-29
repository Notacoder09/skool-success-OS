import type { ReportSection } from "./sections";

// Pure email builder for the Weekly Optimization Report. Mirrors the
// flashcards email module — hand-rolled HTML, no React/MJML
// dependency. The body comes pre-built from sections.ts; this file is
// only formatting.
//
// Wisdom doc: 3-5 minute read max, no charts, no growth-marketing
// language. Email content stays prose-first; we add a tiny "action /
// context" pill in front of each section so the creator can scan.

export interface ReportEmailInput {
  /** Creator's first name; null falls back to "there". */
  firstName: string | null;
  /** Section list as built by sections.ts. */
  sections: ReportSection[];
  /** Header label like "Week of Apr 27, 2026". */
  weekLabel: string;
  /** Variant: weekly or welcome (drives subject + preheader). */
  variant: "weekly" | "welcome";
}

export interface ReportEmailOutput {
  subject: string;
  html: string;
  text: string;
  /** Markdown body persisted in `weekly_reports.body_md` for the viewer page. */
  markdown: string;
}

export function buildReportEmail(input: ReportEmailInput): ReportEmailOutput {
  const subject =
    input.variant === "welcome"
      ? `Welcome to your weekly review (${input.weekLabel})`
      : `Your week — ${input.weekLabel}`;

  const greeting = input.firstName
    ? `Good Monday, ${input.firstName}.`
    : `Good Monday.`;

  const introHtml = `
    <p style="margin:0 0 6px 0;font-size:11px;letter-spacing:0.18em;text-transform:uppercase;color:#6b7280;">
      ${escapeHtml(input.weekLabel)}
    </p>
    <p style="margin:0 0 24px 0;font-size:18px;line-height:1.4;color:#1d1d1d;font-weight:600;">
      ${escapeHtml(greeting)}
    </p>
  `;

  const sectionsHtml = input.sections
    .map((s, i) => renderSectionHtml(s, i + 1))
    .join("\n");

  const closingHtml = `
    <p style="margin:24px 0 0 0;font-size:13px;line-height:1.55;color:#6b7280;">
      Three of these are things to do this week. Two are things to think about. If you only have time for one, do the DM.
    </p>
  `;

  const html = wrapHtml(introHtml + sectionsHtml + closingHtml);

  const text = buildText(input, greeting);
  const markdown = buildMarkdown(input);

  return { subject, html, text, markdown };
}

function renderSectionHtml(section: ReportSection, n: number): string {
  const pillColor = section.tone === "action" ? "#16a34a" : "#6b7280";
  const pillBg = section.tone === "action" ? "#ecfdf5" : "#f5f5f4";
  return `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 18px 0;">
      <tr><td>
        <div style="display:inline-block;background:${pillBg};color:${pillColor};font-size:10px;letter-spacing:0.16em;text-transform:uppercase;padding:3px 8px;border-radius:6px;margin-bottom:8px;">
          ${section.tone === "action" ? `Action ${n}` : "Context"}
        </div>
        <h2 style="margin:0 0 8px 0;font-size:17px;color:#1d1d1d;font-weight:600;">${escapeHtml(section.title)}</h2>
        <p style="margin:0;font-size:15px;line-height:1.55;color:#374151;">${escapeHtml(section.body)}</p>
      </td></tr>
    </table>
  `;
}

function wrapHtml(inner: string): string {
  return `<!doctype html>
<html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/></head>
<body style="margin:0;padding:24px 0;background:#ffffff;font-family:ui-sans-serif,-apple-system,Segoe UI,Roboto,sans-serif;">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:600px;margin:0 auto;">
    <tr><td style="padding:0 24px 32px 24px;">
      ${inner}
    </td></tr>
  </table>
</body></html>`;
}

function buildText(input: ReportEmailInput, greeting: string): string {
  const lines: string[] = [];
  lines.push(input.weekLabel.toUpperCase());
  lines.push(greeting);
  lines.push("");
  let actionN = 0;
  for (const section of input.sections) {
    const tag = section.tone === "action" ? `Action ${++actionN}` : "Context";
    lines.push(`[${tag}] ${section.title}`);
    lines.push(section.body);
    lines.push("");
  }
  lines.push(
    "Three of these are things to do this week. Two are things to think about. If you only have time for one, do the DM.",
  );
  return lines.join("\n");
}

function buildMarkdown(input: ReportEmailInput): string {
  const lines: string[] = [];
  lines.push(`# ${input.weekLabel}`);
  lines.push("");
  let actionN = 0;
  for (const section of input.sections) {
    const tag = section.tone === "action" ? `Action ${++actionN}` : "Context";
    lines.push(`## ${section.title}`);
    lines.push(`*${tag}*`);
    lines.push("");
    lines.push(section.body);
    lines.push("");
  }
  return lines.join("\n");
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
