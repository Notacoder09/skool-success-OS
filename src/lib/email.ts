// Thin Resend HTTP wrapper. Used by:
//  - Auth.js magic-link sender (src/auth/index.ts)
//  - Member flashcard emails (Days 11-13)
//  - Weekly optimization reports (Days 11-13)
//
// We use fetch directly instead of the Resend SDK because the SDK
// imports @react-email/render at the module level, which inflates
// our serverless bundle even when we send plain HTML. ~30 lines of
// fetch pays the same return.

const RESEND_ENDPOINT = "https://api.resend.com/emails";

export interface SendEmailOpts {
  to: string | string[];
  subject: string;
  html: string;
  text: string;
  /** Optional override; defaults to RESEND_FROM env. */
  from?: string;
  /** Optional reply-to. */
  replyTo?: string | string[];
  /**
   * Idempotency key. Resend dedupes within 24h on this. Pass when
   * a retry could otherwise double-send (member flashcards, weekly
   * reports — never auth links since they should always re-send).
   */
  idempotencyKey?: string;
  /** Custom tags for Resend dashboard filtering. */
  tags?: { name: string; value: string }[];
}

export interface SendEmailResult {
  id: string;
}

export class EmailError extends Error {
  readonly status: number;
  readonly body: unknown;
  constructor(message: string, opts: { status: number; body: unknown }) {
    super(message);
    this.name = "EmailError";
    this.status = opts.status;
    this.body = opts.body;
  }
}

export async function sendEmail(opts: SendEmailOpts): Promise<SendEmailResult> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    throw new EmailError("RESEND_API_KEY not set; cannot send email.", {
      status: 0,
      body: null,
    });
  }
  const from = opts.from ?? process.env.RESEND_FROM;
  if (!from) {
    throw new EmailError("RESEND_FROM not set and no `from` override given.", {
      status: 0,
      body: null,
    });
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };
  if (opts.idempotencyKey) {
    headers["Idempotency-Key"] = opts.idempotencyKey;
  }

  const body: Record<string, unknown> = {
    from,
    to: opts.to,
    subject: opts.subject,
    html: opts.html,
    text: opts.text,
  };
  if (opts.replyTo) body.reply_to = opts.replyTo;
  if (opts.tags) body.tags = opts.tags;

  const res = await fetch(RESEND_ENDPOINT, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  const json = (await res.json().catch(() => null)) as
    | { id?: string; message?: string; name?: string }
    | null;

  if (!res.ok) {
    throw new EmailError(
      `Resend ${res.status}: ${json?.message ?? json?.name ?? res.statusText}`,
      { status: res.status, body: json },
    );
  }
  if (!json?.id) {
    throw new EmailError("Resend OK but missing message id.", {
      status: res.status,
      body: json,
    });
  }
  return { id: json.id };
}
