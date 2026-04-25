# ADR-0006 — Timezone: auto-detect from browser

**Date:** 2026-04-25
**Status:** Accepted
**Owner:** Xavier Hines

## Context

Master plan Feature 5 (Weekly Optimization Report) locks delivery at
**Monday 7 AM creator local time**. We need a timezone per creator
without adding onboarding friction.

Xavier flagged that explicitly asking creators “what timezone are you
in?” is unnecessary friction. He also asked whether sending the
report on “the same weekday they signed up” would be simpler — that
would change the locked product promise (Monday) and was rejected in
favor of keeping the spec.

## Decision

- **Auto-detect** the creator’s timezone in the browser on first
  authenticated session using
  `Intl.DateTimeFormat().resolvedOptions().timeZone` and persist it
  on the `creators` row (e.g. `America/New_York`).
- Show the detected zone in **Settings** with a single inline
  “Change” affordance (dropdown of standard tz names) — surface only,
  no onboarding step.
- Fall back to `UTC` if the browser returns nothing valid.
- The weekly cron runs hourly, queries creators whose local
  Monday-7AM falls inside the current hour, and dispatches their
  reports.

Weekly cadence stays **Monday 7 AM local** per the master plan.

## Consequences

- **Easier:** zero onboarding questions about timezone.
- **Easier:** still respects the locked weekly delivery promise.
- **Harder:** DST transitions need to be respected by whatever
  scheduler library handles tz arithmetic (use `date-fns-tz` or
  `Temporal` polyfill — pick during build).
- **Operational:** if a creator travels and we mis-deliver one week,
  Settings → Timezone → Change is a one-click fix.

## Alternatives considered

- **Ask in onboarding** — adds friction for zero meaningful gain.
- **Send on signup-weekday** — would override the locked Monday
  delivery promise. Treated as a spec change request and rejected;
  master plan wins.
- **Always send in UTC at a fixed hour** — pleases nobody; weekly
  reports landing at 3 AM local kill open rates.
