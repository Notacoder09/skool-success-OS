# ADR-0010 — At-risk classification: deterministic, three-rule, no churn-prediction model

**Date:** 2026-04-28
**Status:** Accepted
**Owner:** Xavier Hines

## Context

Days 8–10 of the master plan ship Member Check-ins (Feature 4) and the
"Who to DM today" widget on Pulse + Today. Both depend on a list of
5–7 members the creator should reach out to, ordered by relationship
value, not just risk.

`creator-wisdom-and-product-decisions.md`, Feature 4, gives three
verbatim thresholds for "at-risk":

1. Activity drops 50%+ vs the member's own 30-day baseline.
2. No posts/comments/likes in 14 days when they used to be active.
3. Course progress stalled mid-module for 7+ days.

Three constraints shape implementation:

1. **No feed scraping in v1** (master plan Feature 3, "posts/likes
   ship as 'coming soon' tiles"). Signals 1 and 2 collapse onto the
   only activity timeline we *do* have: course progression
   timestamps. We must be honest about this — the UI says "no course
   activity for 25 days", not "no engagement detected."
2. **Members deserve dignity, not surveillance** (master plan Part 11,
   Operating Principle 2). The list is "DMs to send today", never
   "members at risk of churn." Copy and ranking both have to reflect
   this.
3. **Daily noise is worse than weekly silence** (wisdom doc Part 3,
   open question 1). The list is capped at 7. Anything more is
   unrealistic for a creator to actually DM.

We considered three implementation approaches:

- **A — ML churn model.** Train on member activity + tier + tenure,
  predict probability of churn, rank by probability. Rejected:
  (a) needs months of data we don't have, (b) opaque to the creator
  ("the model says Sarah is 73% at risk" reads as surveillance and
  fails Operating Principle 5 — be transparent about what we know),
  (c) requires retraining infrastructure we shouldn't build before
  paid launch.
- **B — Single threshold ("no activity in 14 days").** Simple and
  honest. Rejected: misses the most actionable signal — someone who
  *started* a lesson and stalled. Wisdom doc explicitly calls out
  mid-module stalls as the highest-leverage check-in.
- **C — Deterministic three-rule classifier (chosen).** Encode the
  wisdom-doc rules directly. Pure function, easy to test, easy to
  explain to a creator ("Bill stalled on Lesson 3 nine days ago" not
  "the model says Bill is at-risk").

## Decision

Use a deterministic three-rule classifier in `src/lib/checkins/`.

**Rules**, in selection precedence (only one fires per member):

1. **`stalled_mid_course`** — `inProgressLessons > 0` AND
   `inProgressLastActivityAt` is ≥7 days old. Most actionable: the
   creator can DM about *that lesson*. Reason copy: "Started a lesson
   but hasn't moved in N days."
2. **`tenure_dropoff`** — `tenureDays >= 30` AND `completedLessons > 0`
   AND `daysSinceActive >= 14`. The wisdom-doc "used to be active,
   now silent" case. Reason copy: "Used to be active. No course
   activity for N days."
3. **`brand_new_ghost`** — `7 <= tenureDays <= 14` AND zero starts,
   zero completions. Catch them before they slide. Bounded upper
   edge so we don't keep flagging the same person forever. Reason
   copy: "Joined N days ago and hasn't started yet."

**Graduates** (completed everything, nothing in progress) are *never*
flagged — they finished the course; that's success, not risk.

**Ranking** ("winnability") combines tenure + prior progress + LTV
(tie-breaker). Tenure is capped at 365 days so one whale doesn't
dominate forever. Members the creator already drafted in the last 24h
are pushed to the bottom of the list, never removed (they might come
back).

**Daily cap = 7.** Wisdom-doc verbatim — "creator can't realistically
DM 50 people."

## Consequences

**Trade-offs accepted:**

- Without feed-scraping, the "no posts/comments in 14d" signal is
  approximated by course-progression activity. We lose visibility
  into chat-only members. Honest gap; surface in Phase 2 with the
  Chrome extension.
- The classifier is rule-based, not learned. A new pattern (e.g.,
  "tier downgrade") needs a new rule and a fresh test, not a model
  retrain. That's the right friction for a tool that has to stay
  trustable to the creator.
- Threshold tweaks (the 7/14/30-day numbers) live in code, not in a
  config table. Rationale: they encode product *opinions*, not
  per-creator settings. If we let creators tune them, the tool turns
  into a generic dashboard — exactly what the wisdom doc tells us not
  to build.

**Tracked separately, not stored on the flag:**

- The `member_check_ins` table (already migrated in
  `src/db/schema/reports.ts`) stores creator *interactions* (drafted,
  copied, dismissed), not derived risk scores. Rationale: scores can
  shift between syncs as new activity comes in; backfilling them is
  pointless. Compute on render; cheap because community sizes are
  bounded.
- The `recordCheckInDraft` server action dedupes within a 24h window
  on `(creatorId, memberId)` so the same member isn't logged 50
  times if the creator switches tones.

## DM tone templates

Three creator-pickable tones from the wisdom doc, encoded as pure
functions in `src/lib/checkins/templates.ts`:

- **Sam style** — "sup, how's it going?" (deliberately tiny)
- **Hamza style** — "saw you haven't been around — what's up bro,
  anything you need?" (warmer, opens the door)
- **Professional** — "Hey [name], noticed you've been quiet…" with
  a tail varied by reason kind (stalled vs dropoff vs ghost) so it
  doesn't read as a mass-DM.

Voice rules from master plan Part 6 are enforced *by template
construction*, not by a downstream LLM filter. No "we" or "we noticed"
language; specific to the member when possible; never panicked.

## "Draft Message" implementation

v1 ships clipboard-copy + open Skool inbox URL (community slug if
known, fallback to root inbox). Honest disclosure under the list
verbatim from wisdom doc:

> Skool doesn't allow us to send DMs directly yet. One click copies
> the draft, one paste in Skool sends it. The Chrome extension we
> ship next will make it true 1-click.

v2 (Chrome extension) replaces this flow with a true 1-click send.
Until then, the friction is honest and short.

## Pulse data persistence

Bundled into the same Days 8–10 ship: a new
`community_metrics_daily` table populated from
`/admin-metrics?range=30d&amt=monthly` during sync step E. Rationale:
mirrors how courses/lessons/progression already persist (sync → DB →
render), keeps `/pulse` fast, and survives Skool dropping or
rewriting older datapoints.

## Tests

- `src/lib/checkins/at-risk.test.ts` — every rule fires/doesn't fire,
  precedence is right, graduates aren't flagged.
- `src/lib/checkins/rank.test.ts` — tenure beats winnability beats
  LTV; tie-breaks are stable; cap respected.
- `src/lib/checkins/templates.test.ts` — name substitution; sam-style
  is short; professional tail varies by reason; no-name fallbacks.
- `src/lib/pulse/aggregate.test.ts` — trend bands (±5% flat
  threshold), nearest-earlier-point fallback, day-of-week sums.
- `src/lib/sync/metrics.test.ts` — date bucketing tolerates malformed
  timestamps and string-shaped numerics.
