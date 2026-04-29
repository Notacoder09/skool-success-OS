// Pure helpers for the 24-48h send window in master plan Feature 2.
//
// "Send flashcards within 24-48 hours of lesson completion (peak
// recall, not 7 days later)" — wisdom doc.
//
// We deliberately keep both bounds:
//   - lower (≥24h): give the lesson time to settle in memory, and
//     avoid double-sending if they completed multiple lessons in a
//     burst (the hourly cron will pick up the second one tomorrow).
//   - upper (≤48h): if for any reason a lesson missed the window
//     (cron downtime, brand-new account backfill, etc.) we don't want
//     to dump a stale email weeks later. After 48h we let it lapse —
//     creators can manually trigger a send if needed, but the default
//     is silence.
//
// All functions are pure, no I/O, no env. Time is injected via `now`
// so tests are deterministic.

export const SEND_WINDOW_LOWER_HOURS = 24;
export const SEND_WINDOW_UPPER_HOURS = 48;

export interface CompletionRecord {
  /** member.id */
  memberId: string;
  /** lesson.id */
  lessonId: string;
  /** Timestamp the member completed the lesson. */
  completedAt: Date;
}

export interface SendWindowOpts {
  /** Optional override; defaults to SEND_WINDOW_LOWER_HOURS. */
  lowerHours?: number;
  /** Optional override; defaults to SEND_WINDOW_UPPER_HOURS. */
  upperHours?: number;
}

/**
 * True iff `completedAt` is within the open send window relative to
 * `now`. Lower bound is inclusive, upper bound is exclusive. Used by
 * the cron route to gate hourly sweeps.
 */
export function isInSendWindow(
  completedAt: Date,
  now: Date,
  opts: SendWindowOpts = {},
): boolean {
  const lower = opts.lowerHours ?? SEND_WINDOW_LOWER_HOURS;
  const upper = opts.upperHours ?? SEND_WINDOW_UPPER_HOURS;
  const ageMs = now.getTime() - completedAt.getTime();
  if (ageMs < lower * 3_600_000) return false;
  if (ageMs >= upper * 3_600_000) return false;
  return true;
}

/**
 * Filters a list of completion records down to those eligible for
 * a flashcard send right now. Stable order (sorted by completedAt asc)
 * so the cron processes oldest-first when it has to truncate.
 */
export function filterDueCompletions(
  completions: CompletionRecord[],
  now: Date,
  opts: SendWindowOpts = {},
): CompletionRecord[] {
  return completions
    .filter((c) => isInSendWindow(c.completedAt, now, opts))
    .sort((a, b) => a.completedAt.getTime() - b.completedAt.getTime());
}

/**
 * Idempotency key shaped to match Resend's 24h dedupe window. Same
 * (member, lesson) pair always produces the same key, so a retried
 * cron tick can never double-send.
 */
export function buildSendIdempotencyKey(
  memberId: string,
  lessonId: string,
): string {
  return `flashcard:${memberId}:${lessonId}`;
}
