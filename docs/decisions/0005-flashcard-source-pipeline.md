# ADR-0005 — Flashcard source pipeline (cheap sources first, optional Whisper)

**Date:** 2026-04-25
**Status:** Accepted
**Owner:** Xavier Hines

## Context

Master plan Feature 2 + wisdom doc Part 2 / Feature 2 lock the layered
content sourcing decision tree (description → PDF → cached transcript
→ optional Whisper). The remaining question is what we feed the model
when the cheap sources are thin, and how to fetch protected video
assets when Whisper does run.

## Decision

The pipeline runs per lesson, in this order, stopping at the first
sufficient source:

1. **Lesson description > 100 words** → use it. **FREE.**
2. **Attached PDF/doc** → extract text via `pdf-parse`, combine with
   description. **FREE.**
3. **Cached transcript in DB** → use it. **FREE.**
4. **Quality gate** — even on free sources, also include lesson
   **title + free metadata + thumbnail context** in the model prompt.
   If combined signal is too thin to produce confident cards AND the
   creator has not opted into Whisper, **skip this lesson with a
   clear, surfaced reason**. We do not produce junk.
5. **Creator has transcription disabled** → SKIP, surface notice.
6. **Creator has hit monthly quota** → SKIP, surface notice.
7. **Creator opted in AND has quota** → run Whisper, cache the
   transcript forever, then generate cards. **PAID** (~$0.006/min,
   counted against monthly quota).

For step 7:

- **Fetching the audio:** server-side fetch of the video/audio URL
  using the creator’s **stored, encrypted Skool session cookies**.
  Same credentials, no second paste. If Skool returns 401, surface a
  clear “reconnect Skool” prompt rather than silently failing.
- **Audio extraction:** stream the video into `ffmpeg` (mono, 16 kHz)
  to keep Whisper cost minimal; only the audio bytes go to OpenAI.
- **Caching:** transcripts keyed by `lesson_id + content_hash`.
  Cache re-use is free (does not count against quota). Cache
  invalidates only when the creator updates the lesson (detected via
  the lesson’s updated-at field or content hash change).
- **Quota accounting:** record `(creator_id, lesson_id, minutes_used,
  ran_at)`; sum-by-month for the cap; per-lesson source attribution
  visible to the creator.

Defaults for new accounts:

- **Flashcards: ON**
- **Transcription: OFF** (creator opts in once they understand the
  tradeoff; onboarding shows the math: “250 min ≈ N lessons of avg
  length M”).

## Consequences

- **Easier:** every cheap source gets used, ROI on Whisper minutes is
  protected, members on covered lessons get flashcards immediately.
- **Easier:** one cookie paste covers all Skool reads, including
  transcription source fetches.
- **Harder:** we own an audio pipeline (ffmpeg subprocess +
  streaming). Containerized via Vercel’s serverless functions or a
  small cron worker — we’ll pick the simpler path that fits memory
  limits.
- **Operational:** the creator UI must always show **per-lesson
  source attribution** (description / PDF / cached / Whisper /
  skipped-because-X). Never silently transcribe; never silently skip.

## Alternatives considered

- **Always run Whisper** — kills ROI, defaults are wrong for cost
  control, contradicts master plan’s “cheap sources first.”
- **Text-only v1 (no Whisper)** — master plan explicitly says v1 is
  not stripped down; we wire all six steps.
- **Third-party transcription vendor** — Whisper is cheap and good
  enough; another vendor adds cost without improving outcomes.
