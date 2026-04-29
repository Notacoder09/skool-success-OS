import type { FlashcardCard } from "./generate";

// Member-facing flashcard email. Tone locked by wisdom doc Feature 2:
//   - neutral teacher voice
//   - first-name in subject + body
//   - card → answer prompt → next card
//   - NO progress metrics, NO upsell, NO community plug
//   - very short body
//
// We intentionally render the email with hand-rolled HTML rather than
// pulling in @react-email/render — the templates are simple and the
// runtime cost of an extra renderer isn't worth it. Same reasoning as
// src/lib/email.ts using fetch directly.

export interface FlashcardEmailInput {
  /** Member's first name. Email skips when this is empty. */
  firstName: string;
  /** Lesson title (rendered verbatim, escape carefully). */
  lessonTitle: string;
  /** 3-5 cards from lib/flashcards/generate. */
  cards: FlashcardCard[];
  /** Position-in-course label for the subject line ("Lesson 3"). */
  lessonLabel: string;
}

export interface FlashcardEmailOutput {
  subject: string;
  html: string;
  text: string;
}

/**
 * Build the subject + html + text body for one student email.
 * Pure (no DB, no env reads) so it's trivial to snapshot-test.
 */
export function buildFlashcardEmail(
  input: FlashcardEmailInput,
): FlashcardEmailOutput {
  const subject = `${input.firstName} — notes for ${input.lessonLabel}, 60-second review`;

  const introHtml = `
    <p style="margin:0 0 16px 0;line-height:1.55;color:#1d1d1d;">
      Hi ${escapeHtml(input.firstName)},
    </p>
    <p style="margin:0 0 24px 0;line-height:1.55;color:#1d1d1d;">
      You finished <strong>${escapeHtml(
        input.lessonTitle,
      )}</strong>. Here are a few quick prompts so the lesson sticks. No need to reply — just read, pause, and answer in your head before scrolling to the next one.
    </p>
  `;

  const cardsHtml = input.cards
    .map((card, idx) => renderCardHtml(card, idx + 1))
    .join("\n");

  const html = wrapHtml(introHtml + cardsHtml + closingHtml(input.firstName));

  const text = buildText(input);

  return { subject, html, text };
}

function renderCardHtml(card: FlashcardCard, n: number): string {
  return `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 18px 0;border:1px solid #e5e7eb;border-radius:10px;background:#fafafa;">
      <tr><td style="padding:18px 20px;">
        <p style="margin:0 0 6px 0;font-size:11px;letter-spacing:0.18em;text-transform:uppercase;color:#6b7280;">Card ${n}</p>
        <p style="margin:0 0 14px 0;font-size:16px;line-height:1.45;color:#1d1d1d;font-weight:600;">${escapeHtml(card.question)}</p>
        <p style="margin:0;font-size:14px;line-height:1.55;color:#374151;">${escapeHtml(card.answer)}</p>
      </td></tr>
    </table>
  `;
}

function closingHtml(firstName: string): string {
  return `
    <p style="margin:24px 0 0 0;font-size:13px;line-height:1.55;color:#6b7280;">
      That's it for this lesson, ${escapeHtml(firstName)}. We'll send another short set after your next one.
    </p>
  `;
}

function wrapHtml(inner: string): string {
  return `<!doctype html>
<html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/></head>
<body style="margin:0;padding:24px 0;background:#ffffff;font-family:ui-sans-serif,-apple-system,Segoe UI,Roboto,sans-serif;">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:560px;margin:0 auto;">
    <tr><td style="padding:0 24px 24px 24px;">
      ${inner}
    </td></tr>
  </table>
</body></html>`;
}

function buildText(input: FlashcardEmailInput): string {
  const lines: string[] = [];
  lines.push(`Hi ${input.firstName},`);
  lines.push("");
  lines.push(
    `You finished "${input.lessonTitle}". Here are a few quick prompts so the lesson sticks. Read each, pause, and try to answer in your head before reading on.`,
  );
  lines.push("");
  for (let i = 0; i < input.cards.length; i++) {
    const card = input.cards[i];
    if (!card) continue;
    lines.push(`Card ${i + 1}`);
    lines.push(card.question);
    lines.push(card.answer);
    lines.push("");
  }
  lines.push(
    `That's it for this lesson, ${input.firstName}. We'll send another short set after your next one.`,
  );
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
