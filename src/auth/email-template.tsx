// Plain-text + HTML magic-link email body. Kept inline (no React Email
// components yet) so the auth flow has zero extra deps. We swap in a
// proper React Email template when we build the member flashcard
// emails (Days 11-13) and use the same toolchain for both.

export interface MagicLinkContent {
  subject: string;
  html: string;
  text: string;
}

const ACCENT = "#d97757"; // terracotta from V2 mockup
const INK = "#1f1d1b";
const MUTED = "#6b6660";
const CANVAS = "#fafaf7";

export function buildMagicLinkEmail(opts: {
  url: string;
  /** ISO host the link points at, e.g. "skoolsuccess.os" — shown for trust. */
  host: string;
  /** Optional first name for greeting; falls back to a neutral opener. */
  name?: string | null;
}): MagicLinkContent {
  const greeting = opts.name ? `Hi ${escapeHtml(opts.name)},` : "Hi there,";
  const subject = "Your sign-in link for Skool Success OS";

  const html = `<!doctype html>
<html lang="en">
  <body style="margin:0;padding:32px 16px;background-color:${CANVAS};font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:${INK};">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:520px;margin:0 auto;">
      <tr>
        <td style="padding:8px 0 24px 0;">
          <span style="font-size:12px;letter-spacing:0.18em;text-transform:uppercase;color:${MUTED};">Skool<span style="color:${ACCENT};">Success</span></span>
        </td>
      </tr>
      <tr>
        <td>
          <p style="margin:0 0 16px 0;font-size:16px;line-height:1.5;">${greeting}</p>
          <p style="margin:0 0 24px 0;font-size:16px;line-height:1.6;">
            Click the button below to sign in. The link is valid for 10 minutes and works once.
          </p>
          <p style="margin:0 0 32px 0;">
            <a href="${escapeAttr(opts.url)}"
               style="display:inline-block;background-color:${INK};color:${CANVAS};
                      text-decoration:none;font-size:15px;padding:12px 20px;border-radius:8px;">
              Sign in to Skool Success OS
            </a>
          </p>
          <p style="margin:0 0 8px 0;font-size:13px;color:${MUTED};line-height:1.5;">
            Or paste this link into your browser:
          </p>
          <p style="margin:0 0 32px 0;font-size:13px;color:${MUTED};word-break:break-all;">
            <a href="${escapeAttr(opts.url)}" style="color:${MUTED};">${escapeHtml(opts.url)}</a>
          </p>
          <p style="margin:0;font-size:13px;color:${MUTED};line-height:1.5;">
            If you didn't request this, you can ignore the email. Sign-in requests for
            <strong>${escapeHtml(opts.host)}</strong> only succeed if someone clicks the link
            from your inbox.
          </p>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  const text = [
    greeting,
    "",
    "Click the link below to sign in to Skool Success OS.",
    "It's valid for 10 minutes and works once.",
    "",
    opts.url,
    "",
    "If you didn't request this, you can ignore the email.",
  ].join("\n");

  return { subject, html, text };
}

function escapeHtml(input: string): string {
  return input.replace(
    /[&<>"']/g,
    (ch) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[ch] ?? ch,
  );
}

function escapeAttr(input: string): string {
  return escapeHtml(input);
}
