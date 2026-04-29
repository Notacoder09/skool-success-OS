# ADR-0009 — AI drop-off insights: Anthropic with honest fallback + cached prose

**Date:** 2026-04-26
**Status:** Accepted
**Owner:** Xavier Hines

## Context

Day 6 of the master plan ships the click-to-zoom + AI-generated insight
prose for the Drop-Off Map (Feature 1). The V2 mockup shows a
prominent "What we're seeing" banner on the course page and a deeper
zoom on the lesson page. Both surfaces want a 2–4 sentence narrative
that names lessons specifically, references creator wisdom, and never
sounds like a panicked dashboard.

Three constraints shape the implementation:

1. **Voice is locked** by docs/skool-success-os-master-plan.md Part 6
   and the wisdom doc Feature 1 copy direction. Drift here is a
   product regression, so the system prompt must be a single source of
   truth, edited like code.
2. **Beta creators may not have an Anthropic key configured on day
   one** (Xavier's `.env.local` is currently empty). A blank insight
   panel breaks the page; "Add an API key to see insights" pushes work
   onto the creator and contradicts the operating principle "we help
   creators do less, not more."
3. **Cost discipline matters at scale.** A naive implementation
   regenerates on every page render — a creator who refreshes the page
   ten times a day burns ten Anthropic calls for no new information.

## Decision

- **Two-mode generator** in `src/lib/ai/insights.ts`:
  - Anthropic mode (Claude Sonnet 4.5, pinned build
    `claude-sonnet-4-5-20250929`) when `ANTHROPIC_API_KEY` is set.
  - Deterministic rule-based fallback when the key is missing or the
    Anthropic call fails. The fallback uses three prose shapes
    (early-course leak, cliff drop, honest-uncertainty) grounded in
    the same wisdom thresholds (day 90, AI Jack's deletion principle,
    "members aren't full-time").
- **Cache layer** in `src/lib/ai/cache.ts` reads/writes the existing
  `lesson_insights` table (already in schema). Three regeneration
  triggers: row missing, row older than 24h, row written by fallback
  while `ANTHROPIC_API_KEY` is now configured (opportunistic upgrade).
- **Server action** `regenerateInsightForLesson` exposes manual refresh
  on the lesson zoom page, throttled to 60s per lesson to prevent
  spend abuse.
- **Honest UI signal:** the banner labels itself as
  rule-based-fallback when the model field is `fallback-rule-v1`,
  with a one-line note pointing the creator at `ANTHROPIC_API_KEY`.

## Consequences

- **Easier:** beta creators get coherent prose on day one regardless
  of API key status. The voice upgrade when they wire up Anthropic is
  visible and motivating, not a "set this up first" wall.
- **Easier:** voice rules live in code. Updating the system prompt
  re-tunes every insight on next regeneration.
- **Easier:** Anthropic spend is ~one call per lesson per 24h per
  creator. For Xavier's test community (4 lessons), that's ≤ 4 calls
  per day — under a cent at Sonnet pricing.
- **Harder:** two prose paths to maintain. We mitigate by testing
  only the fallback (deterministic) and treating the Anthropic call
  as a voice upgrade, not correctness.
- **Operational:** the pinned model name is hard-coded so a model
  swap is an explicit change, not a silent voice drift. Any future
  bump goes through this ADR (or a successor).
- **Privacy:** the prompt sends only the lesson title, position,
  completion %, course title, and member count. No member names,
  emails, or personal data. This stays inside the operating
  principle "we strengthen relationships, not surveil members."

## Alternatives considered

- **Anthropic-only, hard-fail without key** — rejected. Beta creators
  hit a blank page until they configure a key, which contradicts the
  "do less, not more" principle and tanks first-impression demos.
- **Always-fallback, skip Anthropic in v1** — rejected. The locked
  voice rules need a real LLM to fully express; the rule-based prose
  is good but not great. We ship both so the upgrade path is one env
  var away.
- **Generate on cron, never on page** — rejected. First-time pages
  need to render insights immediately, and tying to cron complicates
  the click-to-zoom path on a brand-new lesson. The 24h TTL gives us
  similar amortization without the infrastructure.
- **Per-page caching (Next.js `revalidate`)** — insufficient. We need
  per-lesson granularity (regen one without invalidating the rest)
  and we need persistence across deploys. The DB table gives us both.
