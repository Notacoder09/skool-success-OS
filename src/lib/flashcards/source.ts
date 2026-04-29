// Days 11-13 — content sourcing decision tree for Feature 2 flashcards.
//
// Master plan §"Feature 2 — Source-of-truth question (HARD CONSTRAINT)"
// and ADR-0005 lock the order. We run per-lesson, stop at the first
// match. The function below is deliberately pure (no I/O, no env reads)
// so the rule order is fully testable and the orchestrator stays thin.
//
// The orchestrator turns the descriptor below into actual writes:
//   - kind: "use"   → generate cards from `text`, persist a lesson_content
//                     row with `source` set
//   - kind: "skip"  → persist a lesson_content row with source="skipped"
//                     and the matching skip_reason; no cards generated
//   - kind: "transcribe" → enter the Whisper path. v1 ships the gate;
//                     the audio worker lands in a follow-up sprint.
//                     Until then the orchestrator coerces this back to
//                     "skip / thin_signal" with a copy line that says
//                     "Whisper rollout in progress".
//
// We intentionally lift the "≥100 words" threshold to a constant so
// it appears once and the wisdom-doc reference is obvious in tests.

export const MIN_DESCRIPTION_WORDS = 100;

export type FlashcardSource =
  | "description"
  | "pdf"
  | "cached"
  | "whisper"
  | "skipped";

export type FlashcardSkipReason =
  | "thin_signal"
  | "transcription_disabled"
  | "quota_reached"
  | "fetch_failed"
  | "creator_disabled_lesson";

export interface SourceLessonInput {
  /** Lesson identifier — only echoed back; not used in logic. */
  id: string;
  /** Used in the prompt's "title + free metadata" lift. */
  title: string;
  /** Plain-text description (Skool's lesson body field). */
  description: string | null;
  /** Pre-computed word count from the sync pipeline. */
  descriptionWordCount: number | null;
  /** Skool's attached doc URL. Presence triggers step 2. */
  attachedDocUrl: string | null;
  /** Skool's CDN video URL. Presence triggers step 6 candidacy. */
  videoUrl: string | null;
  /** Used to estimate Whisper minutes against quota. */
  durationSeconds: number | null;
}

export interface SourceCachedTranscript {
  /** lesson_content.id of the cached row. */
  id: string;
  /** Already-extracted text (transcript or pdf). */
  text: string;
  /** Original source of the cached text — surfaced to the creator. */
  source: Exclude<FlashcardSource, "skipped">;
}

export interface SourceCreatorInput {
  /** ADR-0005 default: false on new accounts. */
  transcriptionEnabled: boolean;
  /** Per-month minute quota; 0 = unlimited. */
  transcriptionMinutesQuota: number;
  /** Sum of `transcription_usage.minutes_used` for current month. */
  minutesUsedThisMonth: number;
}

export interface SourceInput {
  lesson: SourceLessonInput;
  cachedTranscript: SourceCachedTranscript | null;
  creator: SourceCreatorInput;
  /**
   * Optional pre-extracted PDF text. The orchestrator will attempt
   * extraction (currently stubbed; pdf-parse lands in follow-up).
   * When null, step 2 falls through to step 3 / 4 just like before.
   */
  pdfText?: string | null;
}

export type SourceDecision =
  | {
      kind: "use";
      source: Exclude<FlashcardSource, "skipped">;
      text: string;
      /** Echoed when the text came from a cached row. */
      sourceContentId?: string;
      /** Estimated Whisper minutes used (only on whisper path). */
      minutesEstimated?: number;
    }
  | { kind: "skip"; reason: FlashcardSkipReason }
  | {
      kind: "transcribe";
      estimatedMinutes: number;
      /** Whisper inputs the orchestrator needs. */
      videoUrl: string;
    };

/**
 * Compose a "title + metadata" preamble that we always include in the
 * model prompt. Even thin descriptions get a useful lift this way —
 * cards reference the lesson by name and position rather than feeling
 * generic.
 */
export function buildPromptHeader(lesson: SourceLessonInput): string {
  const lines: string[] = [];
  lines.push(`Lesson title: ${lesson.title}`);
  if (lesson.durationSeconds && lesson.durationSeconds > 0) {
    const minutes = Math.round(lesson.durationSeconds / 60);
    lines.push(`Approx. lesson length: ${minutes} min`);
  }
  return lines.join("\n");
}

function wordCountOrDerive(input: SourceLessonInput): number {
  if (
    typeof input.descriptionWordCount === "number" &&
    Number.isFinite(input.descriptionWordCount)
  ) {
    return input.descriptionWordCount;
  }
  if (!input.description) return 0;
  return input.description.trim().split(/\s+/).filter(Boolean).length;
}

/**
 * Pure resolver. Decides what content (if any) we should send to the
 * model for this lesson, OR what skip reason to surface to the creator.
 *
 * Step ordering — see ADR-0005:
 *   1. Description ≥ 100 words → use it. (FREE)
 *   2. Cached transcript exists → use it. (FREE)
 *   3. Attached PDF text provided → use it (after orchestrator extracts). (FREE)
 *   4. Transcription disabled → skip "transcription_disabled".
 *   5. Quota reached → skip "quota_reached".
 *   6. Opted-in + has quota + has video → enter Whisper path.
 *   7. None of the above → skip "thin_signal".
 *
 * Steps 2 and 3 are swapped vs ADR-0005 numbering only because cached
 * is always cheaper than re-running PDF extraction (PDF extraction
 * runs upstream of this function in the orchestrator and supplies
 * pdfText only when extraction succeeded).
 */
export function resolveFlashcardSource(input: SourceInput): SourceDecision {
  const descriptionWords = wordCountOrDerive(input.lesson);
  const descriptionUsable =
    !!input.lesson.description &&
    input.lesson.description.trim().length > 0 &&
    descriptionWords >= MIN_DESCRIPTION_WORDS;

  // Step 1 — cheapest source (FREE, instant)
  if (descriptionUsable) {
    return {
      kind: "use",
      source: "description",
      text: input.lesson.description!.trim(),
    };
  }

  // Step 2 — cached transcript / PDF in DB (FREE)
  if (input.cachedTranscript) {
    return {
      kind: "use",
      source: input.cachedTranscript.source,
      text: input.cachedTranscript.text,
      sourceContentId: input.cachedTranscript.id,
    };
  }

  // Step 3 — fresh PDF extraction (FREE; pdf-parse lands later)
  if (
    input.pdfText &&
    input.pdfText.trim().split(/\s+/).filter(Boolean).length >=
      MIN_DESCRIPTION_WORDS
  ) {
    return {
      kind: "use",
      source: "pdf",
      text: input.pdfText.trim(),
    };
  }

  // Step 4 — creator gate
  if (!input.creator.transcriptionEnabled) {
    return { kind: "skip", reason: "transcription_disabled" };
  }

  // Step 5 — quota gate (0 = unlimited; else compare actuals)
  if (
    input.creator.transcriptionMinutesQuota > 0 &&
    input.creator.minutesUsedThisMonth >=
      input.creator.transcriptionMinutesQuota
  ) {
    return { kind: "skip", reason: "quota_reached" };
  }

  // Step 6 — Whisper candidate (orchestrator may still defer this
  // when the audio worker isn't online; that conversion happens above
  // this layer so the decision tree stays pure).
  if (input.lesson.videoUrl) {
    const estimated =
      input.lesson.durationSeconds && input.lesson.durationSeconds > 0
        ? Math.max(1, Math.ceil(input.lesson.durationSeconds / 60))
        : 1;
    return {
      kind: "transcribe",
      estimatedMinutes: estimated,
      videoUrl: input.lesson.videoUrl,
    };
  }

  // Step 7 — nothing usable, even after all the cheap paths.
  return { kind: "skip", reason: "thin_signal" };
}

/**
 * Human-readable badge text for the per-lesson source pill on
 * /flashcards. Single source of truth so the table never shows a
 * label that diverges from the underlying enum value.
 */
export function describeSource(
  source: FlashcardSource,
  skipReason: FlashcardSkipReason | null,
): { label: string; tone: "neutral" | "warning" | "muted" } {
  switch (source) {
    case "description":
      return { label: "From description", tone: "neutral" };
    case "pdf":
      return { label: "From PDF", tone: "neutral" };
    case "cached":
      return { label: "Cached", tone: "neutral" };
    case "whisper":
      return { label: "Whisper transcript", tone: "neutral" };
    case "skipped":
      switch (skipReason) {
        case "transcription_disabled":
          return {
            label: "Skipped — video-only, transcription off",
            tone: "muted",
          };
        case "quota_reached":
          return {
            label: "Skipped — monthly quota reached",
            tone: "warning",
          };
        case "thin_signal":
          return { label: "Skipped — too little content", tone: "muted" };
        case "fetch_failed":
          return {
            label: "Skipped — couldn't reach Skool",
            tone: "warning",
          };
        case "creator_disabled_lesson":
          return { label: "Skipped — disabled for this lesson", tone: "muted" };
        default:
          return { label: "Skipped", tone: "muted" };
      }
  }
}
