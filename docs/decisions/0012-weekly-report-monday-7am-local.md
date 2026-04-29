# ADR-0012 — Weekly Report: Monday 7am-local, hourly cron, idempotent at the row

**Date:** 2026-04-28
**Status:** Accepted
**Owner:** Xavier Hines

## Context

Days 11-13 of the master plan ship Feature 5 (Weekly Optimization
Report). The wisdom doc locks four properties:

- Monday email, 3-5 minute read
- 5 sections (celebrate, DM, lesson to fix, pattern, question)
- Max 3 *actions* per report — sections 4-5 are reflective
- Lands at 7am in the creator's local timezone
- Resend for delivery

Two implementation problems:

1. **Scheduling per-creator local time.** Vercel cron only knows UTC
   and only fires on a fixed cron expression. We have to evaluate
   "is it 7am Monday for *this* creator" inside the route.
2. **Idempotency.** A weekly report should fire exactly once per
   creator per week regardless of how many times the cron fires,
   how many timezone fences the creator straddles (DST, travel),
   or whether a manual "regenerate" button is also clicked.

We considered:

- **A — Per-creator scheduled tasks (e.g. Vercel-style cron objects
  generated at runtime).** Rejected: not supported by Vercel cron;
  would require a second scheduler. Adds infra for no gain.
- **B — Single daily cron at midnight UTC, fan out to creators.**
  Rejected: misses the "7am local" experience for anyone east of
  UTC.
- **C — Hourly UTC cron, evaluate Monday-7am-local per creator
  inline.** Chosen. Cheap (24 invocations/day, each one is a
  bounded select on the creators table), simple, and the 7am
  window is hit naturally for every IANA timezone.

## Decision

Two cron entries in `vercel.json`:

```
{ "path": "/api/cron/flashcards",       "schedule": "0 * * * *" }
{ "path": "/api/cron/weekly-reports",   "schedule": "0 * * * *" }
```

Each route walks every creator (small N), and for the weekly report:

1. Calls `evaluateMondaySchedule(now, creator.timezone)`. The pure
   function in `src/lib/weekly-report/schedule.ts` returns
   `{ shouldFire, weekStartDate, … }`. `shouldFire` is true iff the
   creator's *local* day-of-week is Monday and *local* hour is 7.
2. If `shouldFire === false`, skips the creator with reason
   `schedule_not_due`.
3. If `shouldFire === true`, calls
   `buildAndSendWeeklyReport({ creatorId, now })`. The orchestrator
   gathers signals (top check-in, worst lesson, retention, pulse
   trend, day-of-week, day-90 crossing), composes the 5 sections,
   upserts into `weekly_reports`, and emails via Resend.

### Idempotency layers

1. **Schema unique idx** on `(creator_id, week_start_date)` — one
   row per creator per week. The orchestrator upserts on this key.
2. **Orchestrator early-bail** — if the existing row's `sentAt` is
   non-null, we never re-send; we only refresh the `body_md` so the
   viewer page stays current.
3. **Resend `Idempotency-Key`** — `weekly-report:{creatorId}:{YYYY-MM-DD}`
   so even if the cron and a manual regenerate fire in the same
   second, Resend dedupes for us within 24h.

### Welcome variant

If `daysOnPlatform < 7`, the orchestrator picks the welcome variant
(see `buildWelcomeSections`). 3 sections, less data, more
orientation. Wisdom-doc cap of 3 actions is implicit (the welcome
copy has exactly 1 action).

### Manual regenerate

The "Regenerate this week" button on `/weekly-report` calls the
orchestrator with `ignoreSchedule: true`. The orchestrator computes
the local week-start the same way the cron does, so the upsert hits
the same row. Repeat clicks refresh the markdown body without
re-emailing — they only update `body_md` and never change `sentAt`.

### Retention threshold

`classifyRetention(rate)` (in `src/lib/weekly-report/thresholds.ts`)
codifies the wisdom-doc bands:

- ≥ 0.9 → "good" (Skool's "good" creators)
- ≥ 0.8 → "average" (platform avg)
- ≥ 0.7 → "below" (yellow flag)
- < 0.7 → "bad" (red flag, content review)
- null → "unknown" (not enough data yet — we say so)

The retention rate itself is computed in the orchestrator as a
30-day-active proxy: `members_active_in_last_30d / total_members`.
We deliberately don't compute retention until the community has at
least 5 members so we don't grade a community that's barely begun.

### Day-90 milestone

Members whose `joinedAt` is between `now - 97d` and `now - 90d`
crossed day 90 inside the last 7 days. We surface the
longest-tenured one (oldest joinedAt in that window) so the
celebration anchors on continuity, not novelty.

## Consequences

**Trade-offs accepted:**

- A creator who flips their timezone mid-week could in theory miss a
  report (their old TZ already fired) or get one slightly off. The
  unique idx prevents duplicates; the worst case is a single skipped
  week. Acceptable for v1.
- Retention is a 30d-active *proxy*, not a true churn rate. Honest:
  the email body says "retention rate" but the wisdom-doc thresholds
  are calibrated against this same proxy. When we have enough
  longitudinal snapshots we can replace it without changing the
  thresholds.
- 24 cron invocations/day × N creators per invocation. Each one is
  a single creator-by-id evaluate + (almost always) a no-op return.
  Vercel cost stays well inside the free tier for the foreseeable
  future.

**Tests** (all in `src/lib/weekly-report/`):

- `schedule.test.ts` — Monday/non-Monday, multiple timezones (NYC,
  Tokyo, UTC), invalid IANA strings fall back to UTC.
- `thresholds.test.ts` — every retention band fires correctly,
  null returns "unknown".
- `sections.test.ts` — every section builder; `buildAllSections`
  enforces 5-section structure and 3-action cap; welcome variant
  fires when `isFirstWeek`.
- `email.test.ts` — subject variants, escaping, no growth-marketing
  language, every section renders to HTML and text.
- `render.test.ts` — markdown→viewer-block parser round-trips the
  email module's output.
