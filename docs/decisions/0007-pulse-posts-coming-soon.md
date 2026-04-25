# ADR-0007 — Pulse: posts/likes ship as “coming soon” in v1

**Date:** 2026-04-25
**Status:** Accepted
**Owner:** Xavier Hines

## Context

Master plan Feature 3 (Community Pulse) and the V2 mockup both show
metrics tiles for total members, posts, likes, and lessons completed.
The completed Skool API recon does **not** include a confirmed posts
or likes endpoint, and the V2 mockup itself renders Likes as
“coming — unlocking soon.” Building feed scraping in v1 risks scope
creep against a 14-day build window.

Xavier confirmed: ship Pulse with what we have, label posts/likes as
“coming.”

## Decision

In v1, Pulse renders:

- **Total members** (from `admin-metrics`)
- **Lessons completed** (from per-member progression)
- **Daily engagement (lessons completed + activity)** chart from
  `admin-metrics` time series
- **Activity by day of week** heatmap from the same series

Posts and Likes tiles render as **placeholder “coming soon”** chips
matching the V2 mockup (`coming` badge), not as zeros and not as
hidden cards. We never display a metric we can’t back with real data.

Adding posts/likes is filed under Phase 2+ (alongside Post Coach).

## Consequences

- **Easier:** Pulse ships on schedule with honest data only.
- **Easier:** sets pattern for the rest of the app — “if we don’t
  have it, we say so visibly” (mirrors Operating Principle #5).
- **Harder:** when posts/likes do land, we need to be careful the
  “coming soon” chip swap doesn’t break the layout.
- **Operational:** none.

## Alternatives considered

- **Hide the tiles entirely** — loses the visual rhythm of the
  mockup and trains creators to expect less than we plan to ship.
- **Estimate posts/likes from indirect signals** — would violate
  honesty principles and produce noise.
- **Build feed scraping now** — pure scope creep against the locked
  14-day plan.
