# ADR-0011 — Flashcards: ship the gates, defer heavy extraction

**Date:** 2026-04-28
**Status:** Accepted
**Owner:** Xavier Hines

## Context

Days 11-13 of the master plan ship Feature 2 (Flashcards). The wisdom
doc is firm on the *experience*:

- 3-5 cards per lesson, never more
- Send 24-48 hours after lesson completion
- Default ON for flashcard generation, default OFF for video
  transcription
- Per-lesson source visibility — the creator always knows where the
  cards came from

ADR-0005 (`docs/decisions/0005-flashcard-source-pipeline.md`) named
the priority order:

1. Lesson description ≥100 words → use it
2. Attached PDF → extract → use it
3. Cached transcript → use it
4. Video + transcription enabled + quota left → Whisper
5. Otherwise → skip with `thin_signal`

The conflict: steps 2 (PDF parse) and 4 (Whisper) require dependencies
the project doesn't have today — `pdf-parse` (small, but new), and
`openai` Whisper plus `ffmpeg` (large, infra-heavy). The user's
standing rule is "no new dependencies without flagging first."

Three options were considered:

- **A — Ship description-only and remove PDF/Whisper from ADR-0005.**
  Rejected: walks back a documented decision, and the wisdom doc
  explicitly calls out PDFs and transcripts as content sources we
  treat as first-class.
- **B — Add `pdf-parse` + `openai` + an ffmpeg layer in this drop.**
  Rejected for now: adds three dependencies without prior buy-in,
  and ffmpeg in particular needs Vercel Lambda layer setup that
  belongs in its own ship.
- **C — Ship the *gates* now, defer the *extraction*.** Chosen.
  Build every decision branch (description / PDF / cached / Whisper /
  skipped), every gate (transcription enabled flag, quota, content
  hash dedupe), the full UI and source-visibility table — but for
  PDF and Whisper the resolver returns a `transcribe`/`extract`
  decision that the orchestrator records as "pending Whisper" or
  "pending PDF extraction" without doing the heavy work. When the
  creator flips the toggle and we wire up the actual workers, no
  schema or UI changes are required.

## Decision

In `src/lib/flashcards/source.ts` the `resolveFlashcardSource`
function returns one of three shapes: `use`, `skip`, or `transcribe`.
The orchestrator handles each:

- **`use`** with a real `text` payload → run Anthropic, write
  `flashcards`, ready to send.
- **`skip`** → record `thin_signal` / `transcription_disabled` /
  `quota_reached` on `lesson_content` and surface the reason verbatim
  in the per-lesson table on `/flashcards`.
- **`transcribe`** → record a `thin_signal`-with-rationale row
  pointing at "pending Whisper" until the worker exists. Idempotent:
  re-running the resolver after enabling Whisper doesn't double-charge
  the quota because the orchestrator only counts `transcription_usage`
  rows it inserted, never decisions in flight.

PDF extraction follows the same shape — `attachedDocUrl` triggers a
`use { source: "pdf" }` decision, but the orchestrator currently
records a "pending extraction" skip. Wiring `pdf-parse` is a one-line
change in the orchestrator; no new gate, schema, or UI work is
needed when it lands.

The `/flashcards` page renders source pills for every lesson:
"Description", "PDF", "Cached transcript", "Whisper", "Skipped: <why>".
Pending extraction appears as "Awaiting PDF/Whisper" so the creator
can see exactly what we *would* do.

## Consequences

**Trade-offs accepted:**

- Day 1 coverage is description-only for most lessons. Honest:
  the creator sees "Skipped: thin signal" or "Awaiting Whisper"
  per-lesson, never silence.
- We carry resolver code paths for sources we don't yet read from.
  This is on purpose — it locks the contract, the UI, and the gates
  in place so the eventual `pdf-parse`/Whisper flip is small and
  reversible.
- The 3-5 cards cap and the 24-48h send window are enforced
  regardless of source — `capCards()` runs after every Anthropic
  response, and `isInSendWindow()` filters every dispatcher pass.

**Tested:**

- `src/lib/flashcards/source.test.ts` — priority ordering, every
  skip reason fires under the right input.
- `src/lib/flashcards/generate.test.ts` — 3-5 cap holds for the
  fallback path; parser tolerates messy LLM output.
- `src/lib/flashcards/timing.test.ts` — 24h-after-completion is
  the floor, 48h is the ceiling, dispatcher filters correctly.
- `src/lib/flashcards/email.test.ts` — escaping, no marketing
  language, every card renders.

## Follow-up

When the user approves new dependencies:

1. Add `pdf-parse` (single dependency, ~120KB). Wire it into the
   orchestrator's `transcribe`/extract branch.
2. Add `openai` + a Vercel Lambda layer for ffmpeg, or a separate
   worker (Render / Modal). Whisper calls debit
   `transcriptionMinutesQuota` per `transcription_usage` row.
3. The cron, the UI, and the schema do not need to change.
