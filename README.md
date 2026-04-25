# Skool Success OS

A retention and completion intelligence system for Skool community creators.
Helps community owners catch members before they cancel, fix the lessons
people drop off on, and ship student-facing flashcards by email — without
making the creator log into yet another dashboard daily.

## Status

Pre-build, foundation phase. Locked specs, v1 development started
April 2026. Target: working beta in 14 days.

## Read these first (in this order)

If you’re picking this project up for the first time — or you’re an AI
coding agent starting a build session — read these documents top to bottom
before writing any code.

1. [`docs/skool-success-os-master-plan.md`](docs/skool-success-os-master-plan.md) —
   Full product vision, locked v1 features, technical foundation, auth
   strategy, design system, pricing, day-by-day build sequence. **Single
   source of truth.**
2. [`docs/creator-wisdom-and-product-decisions.md`](docs/creator-wisdom-and-product-decisions.md) —
   Extracted wisdom from Sam Ovens, Andrew Kirby, Alex Hormozi, and Hamza
   (Skool’s top creators and platform founder). Maps directly to v1 feature
   defaults, copy direction, and thresholds. Use this when making any
   feature decision.
3. [`docs/mockups/`](docs/mockups/) — Locked V2 visual reference
   (`skool-success-mockup-v2.html` + screenshots). The product should look
   and feel like this. Open the HTML in a browser.
4. [`docs/decisions/`](docs/decisions/) — Architectural Decision Records
   (ADRs). Short notes capturing the “why” behind each locked technical
   choice (database, auth, encryption, CSV flow, flashcard sourcing, etc.).
   Read before changing any of those areas.

If anything in instructions, code review, or PRs contradicts the master
plan, **flag it**. The master plan wins until it is explicitly updated.

## What we’re building (60-second version)

The product: five features that together help a Skool creator keep their
members from churning.

1. **Drop-Off Map** — visual heatmap of course completion. Click any
   lesson to see AI-generated insight on why members likely drop off
   there.
2. **Student Flashcards** — auto-generated, **email-delivered to enrolled
   members**. Members are the audience; creators see settings + previews.
3. **Community Pulse** — what’s happening in the community right now,
   who the regulars are, time-of-day activity. Posts/likes shipped as
   “coming soon” tiles in v1.
4. **Member Check-ins** — ranked list of 5–7 members the creator should
   DM today, with draft messages.
5. **Weekly Optimization Report** — Monday email, 3–5 min read, five
   action items. Timezone auto-detected from the browser.

**Positioning:** “Help your community actually finish what they started.
Better retention, less churn, members who stick around.”

**Who buys:** Skool community creators with 30–50+ paying members.

**Pricing:** $47/mo founding (first 30) → $97 / $297 / $697 standard tiers.

## Stack

- **Frontend:** Next.js 14 (App Router), TypeScript, Tailwind, deployed on
  Vercel
- **Database:** Postgres on **Neon** (serverless driver) — see
  [ADR-0001](docs/decisions/0001-database-neon-postgres.md)
- **ORM:** Drizzle (lightweight, serverless-friendly migrations)
- **Auth (creator login):** NextAuth.js / Auth.js with **magic link via
  Resend** — see
  [ADR-0002](docs/decisions/0002-auth-magic-link-via-resend.md)
- **Skool credentials:** AES-256-GCM at rest, app secret in Vercel env —
  see [ADR-0003](docs/decisions/0003-encrypted-skool-credentials.md)
- **AI:** Anthropic Claude API (insights, flashcard generation, report
  copy)
- **Transcription:** OpenAI Whisper (only when creator opts in AND has
  quota; cheapest sources first) — see
  [ADR-0005](docs/decisions/0005-flashcard-source-pipeline.md)
- **Email:** Resend (magic link + member flashcards + weekly creator
  report)
- **Payments:** Stripe (deferred to pre-paid-launch)

## Skool API integration

The Skool API is undocumented. We did our own endpoint reconnaissance and
confirmed which endpoints work. Full results in the master plan, Part 4.

**Working endpoints**

- Course tree and lesson data
- Per-member course progression
- Group analytics (async token pattern)
- Admin metrics with 30-day time series

**Confirmed gap**

No `/members` list endpoint exists. Skool deliberately limits visibility
to ~30 members even for community owners. We handle this with an
**optional, guided CSV import** in Settings (only surfaced when we detect
the gap matters) — see
[ADR-0004](docs/decisions/0004-csv-member-import.md).

**Recon code:** Available at `~/Desktop/skool-recon/skool-recon.js` on
Xavier’s machine. Ported into this repo as `lib/skool-api/`.

## Build sequence (high level)

| Days   | Focus                                                                               |
| ------ | ----------------------------------------------------------------------------------- |
| 1–3    | Foundation: Next.js scaffold, DB schema, auth, encrypted credential storage, Skool API client |
| 4–7    | Drop-Off Map (Feature 1)                                                            |
| 8–10   | Community Pulse + Member Check-ins (Features 3 + 4)                                 |
| 11–13  | Flashcards + Weekly Report (Features 2 + 5)                                         |
| 14     | Polish, deploy beta to Vercel                                                       |
| 15–30  | Beta with ~4–10 friendly creators, free, feedback loop                              |
| ~30    | Pre-paid-launch legal session (Skool TOS review, our TOS, security page)            |
| ~30–35 | Founding member launch, $47/mo, first 30 creators                                   |

Detailed daily breakdown in master plan, Part 9.

## Operating principles (constrains every decision)

1. We help creators **DO LESS**, not more.
2. We **strengthen relationships**, not surveil members.
3. We **trust creator intuition**.
4. We **respect Skool’s design intent**.
5. We are **transparent about what we can’t know**.

If a feature contradicts one of these, redesign or kill it. Full reasoning
in the wisdom doc.

## Development principles (apply to every commit)

- **Default to asking before architectural decisions, not after.**
- **Document small independent decisions** as short ADRs in
  `docs/decisions/`.
- **Commit incrementally** with clear messages, not giant commits.
- **No “TODO: handle errors” shortcuts.** If we’re not handling a case,
  we either handle it or open a tracked issue with a clear next step.
- If user instructions contradict the master plan, **flag it before
  acting**.

## Sister repo

`skool-success` (this repo’s predecessor) holds the API recon code and
exploratory work. **Do not commit production code there.** This repo
(`skool-success-os`) is the actual product.

## Contact

Xavier Hines — solo developer, Atlanta.
