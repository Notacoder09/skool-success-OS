# Skool Success OS — Master Build Plan

**Owner:** Xavier Hines
**Last updated:** April 24, 2026
**Status:** Build-ready. v1 development started immediately.
**Purpose:** Single source of truth. Hand this to Claude Code. Update as we ship.

> **For any AI coding agent:** Read this top to bottom before writing any
> code. Then read `creator-wisdom-and-product-decisions.md` for v1 feature
> behavior and copy direction. Both files together = the build spec.

---

## Part 1 — What We’re Building

### One-line description

A retention and completion intelligence system for Skool community
creators. Surfaces drop-off, flags at-risk members, drafts the right DMs
to send, and ships student-facing flashcards by email — all without
making the creator log into yet another dashboard daily.

### Positioning (final, locked)

NOT “analytics tool for Skool creators.” YES “Help your community
actually finish what they started. Better retention, less churn, members
who stick around.”

We attack the **outcome** (retention/churn), not the **mechanism**
(analytics). This serves both beginner creators (who don’t know what
analytics are) and sophisticated ones (who already know they need them).

### Who buys this

Skool community creators with 30–50+ paying members who:

- Notice members aren’t finishing the course
- Notice members going quiet before cancelling
- Don’t have time to manually DM every member
- Want their community to feel like Sam Ovens describes — alive, with
  regulars, low churn

### The enemy (use in copy)

The **content graveyard**. Courses that sell but never get consumed.
Members who join, ghost, and cancel without anyone noticing until the
Stripe email lands.

### What this is NOT

- Not a generic course platform
- Not a Skool competitor
- Not analytics-for-analytics-sake
- Not a flashcard app (flashcards are a feature, not the product)
- Not a content-ripping or scraping tool

---

## Part 2 — V1 Feature Set (LOCKED)

Five features. No additions before launch. Anything filed for “Phase 2+”
stays filed.

### Feature 1 — Drop-Off Map with AI Insights

Visual heatmap of the creator’s course. Each lesson shows completion
rate. Click any lesson to zoom in and see a short AI-generated
explanation of likely drop-off causes, grounded in the data and creator
wisdom.

Detailed defaults, copy, and thresholds: see
`creator-wisdom-and-product-decisions.md`, Part 2, Feature 1.

### Feature 2 — Student Flashcards (email-delivered)

Auto-generated flashcards from each lesson, delivered to enrolled
members by email. **Members are the audience.** Default ON for all
students. Creator gets a soft warning if they try to disable it.
Frequency capped to avoid overwhelm.

#### Source-of-truth question (HARD CONSTRAINT)

Skool’s API does not provide video transcripts. We have to handle this
honestly.

**Decision tree for content per lesson** (run in order, stop at first
match):

1. Lesson has a written description with > 100 words → use it. **FREE.**
2. Lesson has attached PDF/doc → extract text, combine with description.
   **FREE.**
3. Cached transcript exists in our DB from prior run → use it. **FREE.**
4. Creator has transcription disabled in settings → SKIP this lesson,
   show a notice (“video-only, transcription off”).
5. Creator has hit their monthly transcription quota → SKIP, show a
   notice (“quota reached, upgrade or wait”).
6. Creator opted in AND has quota → run Whisper API on the video, cache
   the transcript, use it. **PAID** (~$0.006/min).

**Key principles**

- **Cheap sources first.** Whisper only fires when nothing cheaper works
  AND the creator authorized it.
- **Quality gate** before falling back to Whisper: also use lesson
  title, free metadata, and thumbnail context. If the combined text is
  thin or generic and the creator hasn’t opted in, skip with a clear
  reason.
- **Transcripts cached forever** — we never re-transcribe the same
  lesson unless the creator updates it.
- **Always transparent:** creator sees per-lesson which source was used
  and why some are skipped.
- **Default state for new accounts:** transcription OFF. Creator opts in
  once they understand the tradeoff.

v1 ships with all six steps. v1 is **not** a stripped-down “text-only”
version — we wire up Whisper from day 1, gated behind the settings
toggle and quota system. Creators who want full coverage flip the
switch.

**Onboarding flow shows reality:** “We’ve scanned your N lessons. M can
generate flashcards immediately from text/PDFs. K are video-only —
toggle on auto-transcription to include those, or skip and the system
still works for the M we have.”

Detailed defaults, copy, and thresholds: see
`creator-wisdom-and-product-decisions.md`, Part 2, Feature 2.

### Feature 3 — Community Pulse Dashboard

The creator’s “what’s happening in my community right now” view.
Daily/weekly activity patterns, who the regulars are, who’s gone quiet,
time-of-day heatmap. Light, scannable, action-oriented.

**v1 scope:** posts and likes are shipped as **“coming soon”** tiles in
the UI (matching the V2 mockup). No feed scraping in v1.

Detailed defaults: wisdom doc Part 2, Feature 3.

### Feature 4 — Member Check-ins (At-Risk)

Ranked list of 5–7 members the creator should DM today, ordered by
relationship value, not just risk. Each row has a “Draft Message”
button.

- **v1 implementation:** “Draft Message” copies the message to clipboard
  and opens the Skool DM tab. Honest disclosure shown: “Skool doesn’t
  allow direct DM sending yet. One click copies, one paste sends.”
- **v2 implementation:** Chrome extension enables true 1-click send.

Detailed defaults: wisdom doc Part 2, Feature 4.

### Feature 5 — Weekly Optimization Report

Email lands Monday 7 AM creator’s **local time** (timezone auto-detected
from browser at signup; editable in Settings). 3–5 minute read. Five
sections, each one action-oriented:

1. One thing to celebrate (amplify in a community post)
2. One person to DM today
3. One lesson to fix
4. One pattern worth knowing
5. One question for the creator

First-week welcome variant: less data, more orientation.

Detailed defaults: wisdom doc Part 2, Feature 5.

---

## Part 3 — Phase 2+ (FILED — do not build in v1)

These are confirmed valuable but explicitly NOT v1. Touching them before
paid launch = scope creep.

- **Post Coach** — analyzes top-performing posts in the community,
  recommends similar new ones (Xavier’s idea, addresses “1–2 likes
  slump”)
- **Churn Reason Tracker** — alerts creator when member goes cold,
  message templates, log responses, surface patterns over time
- **AI chat assistant for students** — student-side support
- **SMS nudges** — for high-tier creators or high-tier students
- **Multi-community management** — for creators running 2+ communities
- **Testimonial extractor** — auto-find and surface quoteable wins from
  the feed
- **Chrome extension** (auth upgrade from cookie paste, true 1-click DMs)
- **Native member-list capture via extension** (passive harvesting as
  creator browses)

---

## Part 4 — Technical Foundation (CONFIRMED)

### Stack

- **Frontend:** Next.js 14 (App Router), TypeScript, Tailwind, deployed
  on Vercel.
- **Database:** Postgres on **Neon** (serverless driver). See
  `docs/decisions/0001-database-neon-postgres.md`.
- **ORM:** Drizzle (migrations + typed queries; serverless-friendly).
- **Auth:** NextAuth/Auth.js for our app login (magic link via Resend).
  Skool credentials stored encrypted (AES-256-GCM) in DB. See
  `docs/decisions/0002-auth-magic-link-via-resend.md` and
  `docs/decisions/0003-encrypted-skool-credentials.md`.
- **AI:** Anthropic API (Claude). Already familiar, already integrated
  in Xavier’s other projects.
- **Transcription:** OpenAI Whisper, gated behind opt-in + quota. See
  `docs/decisions/0005-flashcard-source-pipeline.md`.
- **Email:** Resend for transactional + flashcards + weekly reports.
  Cheap, dev-friendly.
- **Payments:** Stripe (defer to pre-paid-launch — v1 beta is free).

### Skool API — what we know works (from completed recon)

- **Base URL:** `https://api2.skool.com`
- **Auth:** Cookies — `auth_token` (JWT) + `client_id`. Read from
  creator’s logged-in browser, paste into our app.

**Confirmed working endpoints**

- `GET /courses/{course_id}` → full course tree with children
- `GET /groups/{group_id}/courses` → list all courses in group
- `GET /groups/{group_id}/member-course-permissions?progression=true&member={id}`
  → per-member course progression
- `GET /groups/{group_id}/analytics-overview-v2` → returns token, then
  `GET wait?token={t}` for actual data (async pattern)
- `GET /groups/{group_id}/analytics-growth-overview-v2` → same async
  pattern
- `GET /groups/{group_id}/admin-metrics?range=30d&amt=monthly` →
  time-series of `total_members[30]`, `active_members[30]`,
  `daily_activities`

**Confirmed dead ends (404)**

- No `/members` list endpoint exists. Skool deliberately limits
  visibility to ~30 members even for owners of communities with 19,000+
  members.

**Implications of the members-list gap:** Not a blocker. Three
workarounds:

1. **Creator uploads CSV export** from Skool’s admin panel (manual but
   works on day 1) — this is also how we capture member emails for the
   flashcard send list. See
   `docs/decisions/0004-csv-member-import.md`.
2. Harvest member IDs from posts/comments endpoints when found.
3. v2 Chrome extension passively captures IDs as creator browses their
   community.

**Honest positioning of this gap:** “Skool hides your member data even
from you. We surface what we can. Coverage grows over time.”

### Recon code location

`~/Desktop/skool-recon/skool-recon.js` (Node, dotenv, 133 lines). Tested
~35 endpoints. Reusable in v1 — pull into new repo as `lib/skool-api/`.

### Test community details (Xavier’s “App Development” community)

- **User ID:** `d9d745b78db4444e9c445f14ba453ba6`
- **Group ID:** `ca1d1972c55b437ba42d0daa9e7d63a7`
- **Course ID (meme):** `9d515fe8530f4a02b1cded73cee8da79`
- **Member IDs:**
  - Bill T: `a7c8f33668dc4bd49d4306c5c1ac3f12` (66% progress)
  - Yuy Yuy: `90d98eb5a4774afbbde9559d4c7a0291` (0%)

Use these for development. Real data, real progress numbers, no need to
mock.

---

## Part 5 — Auth Strategy (LOCKED)

### v1 (ship now): Session cookie paste

- Creator copies their `auth_token` and `client_id` cookies from their
  logged-in Skool browser session.
- Pastes into our settings panel.
- We encrypt at rest (AES-256-GCM), never log, rotate on creator
  request.
- Build a clear “How to find your cookies” walkthrough with screenshots
  in onboarding.

**Why this for v1:** Ships in 2 weeks instead of 2 months. Validates
product-market fit before we invest in extension. We’re transparent with
creators about the tradeoff.

### v2 (~4 weeks post-launch): Chrome extension

- ~300 lines of code.
- Captures session automatically when creator browses Skool.
- Eliminates the cookie-paste step.
- **Blocker:** Chrome Web Store review (1–3 weeks). Start the listing
  process during v1 beta so it’s approved when we’re ready.

### Why NOT a Skool partnership

Skool has publicly denied thousands of custom embed/integration requests
over the past 2+ years. Sam Ovens’ team explicitly does not allow
third-party embeds. Realistic partnership conversation only happens
**after** we have 500+ paying creators and they can’t ignore us. Until
then, we operate as an independent tool with creator-granted
authorization.

### Security commitments (publish on landing page)

- AES-256-GCM encryption at rest for all stored credentials
- Session tokens never logged
- Creator can rotate or revoke at any time
- We never access communities the creator doesn’t own
- We never use creator data to train models or sell to third parties

---

## Part 6 — Design System (LOCKED — V2 mockup direction)

The V1 mockup (dark editorial, terracotta accent, “Command Center”
language) is **rejected and archived** as `skool-success-mockup.html`.
Reasons documented inline in that file (kept as reference of what NOT to
do).

The **V2 mockup** (`docs/mockups/skool-success-mockup-v2.html`) is the
**locked design reference**. Use this as the visual spec.

### V2 design tokens

- **Background:** `#fafaf7` (warm off-white)
- **Skool-inspired highlight:** `#fff9e8` (cream)
- **Accent (terracotta, softer):** `#d97757`
- **Positive (forest green):** for completion %, healthy retention
- **Headlines:** Fraunces serif, lowercase, conversational
- **Body:** system stack, sized for readability not density

### Language locks (replace anywhere in the app)

| Don’t say         | Say                            |
| ----------------- | ------------------------------ |
| Command Center    | Today                          |
| At-Risk Members   | Member Check-ins               |
| Active Users      | Regulars This Week             |
| Engagement Rate   | Posts that landed              |
| Churn Rate        | Retention this quarter         |
| Dashboard         | (just don’t use this word)     |

### Tone of AI-generated copy

- Reads like a thoughtful operator wrote it
- References specific names, specific lessons (not “Member #4729”)
- Cites creator wisdom directly when relevant (“Andrew Kirby found
  that…”)
- Honest about uncertainty (“We don’t know why Sarah went quiet — only
  she does”)
- Never growth-marketing language (“12% growth this week”)
- Never panicked language (“URGENT: 5 members at risk”)

### Greeting copy on the Today view

“Good [morning/afternoon], Xavier. Here’s what’s happening today.”
Not: “Welcome back. Your community has 247 active members.”

### Tone for member-facing emails (flashcards)

Neutral teacher. Short. Uses the member’s first name. Frames the cards
as notes for *this lesson*. No hype, no metrics in the body. Subject
line example: “Notes for Lesson 2 — review in 60 seconds.”

---

## Part 7 — Pricing (LOCKED)

### Beta period (free, ~30 days)

- ~4–10 creators get full access free for 30 days in exchange for honest
  feedback.
- Beta includes a generous transcription allowance (1000 minutes) so
  they can fully test flashcards.
- Beta creators **auto-convert** to founding member rate at the end of
  beta — no card needed during beta, but signup terms make conversion
  explicit (free trial style).
- We take their feedback into v1.1 before opening paid access.

### Tiers and what’s included

| Tier      | Price                | Transcription minutes/month | Best for                                              |
| --------- | -------------------- | --------------------------- | ----------------------------------------------------- |
| Founding  | $47/mo (lifetime)    | 250                         | First 30 paying creators only                         |
| Starter   | $97/mo               | 500                         | 1 community, up to 500 members                        |
| Pro       | $297/mo              | 2,000                       | 1 community 500+ members, OR multiple communities     |
| Agency    | $697+/mo             | Unlimited (fair use)        | People managing communities for clients               |

### Founding member tier specifics

- $47/mo for life for first 30 paying creators
- Locked rate, never increases for them
- Creates urgency and rewards early believers
- Becomes a marketing asset (“our first 30 creators paid $47, then we
  raised to $97”)

### Transcription quota reasoning

- Whisper API costs us ~$0.006/min. At 2000 minutes (Pro tier), our
  cost is ~$12/month per creator. Healthy margin on $297/mo.
- Transcripts cache forever in our DB — the creator only burns minutes
  ONCE per lesson, then it’s free re-use.
- Average creator has 30 lessons × 20 min = 600 minutes total course
  content. Pro’s 2000 minute allowance covers their entire course
  library 3× over.
- Founding tier’s 250 minutes is intentionally enough to transcribe a
  small course or selectively transcribe key lessons of a larger one.
  Forces creators to be selective without crippling them. Onboarding
  shows the math up front so expectations are aligned.
- Quota resets monthly. **Cached transcripts persist forever and don’t
  count against quota on re-use.**

### Why these price points (grounded in research)

- Average paid Skool community is ~$50/mo (per Sam/Kirby data in
  wisdom doc)
- Top-tier Skool community owners charge $129–997/mo themselves
- $47 founding rate signals “we’re new, take a chance on us”
- $97 Starter is below the pain threshold for any creator making
  $1,000+/mo from their community
- $297 Pro is justified the moment we save them 5+ hours/week or
  prevent 2 cancellations
- Price anchoring: a creator paying themselves $129/mo for THEIR
  community will not blink at paying $97 for a tool that protects that
  revenue
- Generous transcription quotas make every tier feel like a deal, not a
  trap

---

## Part 8 — Legal / TOS (DEFERRED to pre-paid-launch session)

This gets a dedicated 1–2 hour working session **after** v1 is built and
beta is running, **before** we open paid signups. Topics for that
session:

1. **Skool TOS review.** Read carefully, flag clauses that affect us.
2. **Our own TOS draft.** Protects us, sets creator expectations.
3. **Privacy policy and security page.** Publish before paid launch.
4. **Takedown plan.** What do we do if Skool sends a cease-and-desist on
   day 60? Need this answered before we have customers depending on us.
5. **LLC formation question.** Worth it at this stage, or wait?

> **PERMANENT REMINDER:** Before paid launch — conduct Skool TOS review
> + legal prep session.

### What we already know is fine vs gray vs bad

**Fine**

- Using a creator’s own session to read their own community data on
  their behalf
- Building a tool that helps creators use Skool better (net positive
  for ecosystem)
- Not reselling Skool data, not competing with Skool

**Gray (manageable, not blockers)**

- Accessing undocumented API endpoints (most platforms tolerate when
  tools benefit their creators)
- Automating actions a creator could take manually

**Hard rules we won’t break**

- Never let a creator use our tool on a community they don’t own
- Never advertise “we reverse-engineered Skool’s API” — position as
  “built for Skool creators”
- If Skool asks us to stop something, we stop

---

## Part 9 — Build Sequence (the actual plan)

### Day 0

- [x] Master plan rewritten ← this doc
- [x] Creator wisdom doc complete
- [x] V2 mockup locked
- [x] API recon complete
- [x] Create new GitHub repo `skool-success-os` (separate from
  `skool-success` recon repo)
- [x] Initial commit: README, this master plan, the wisdom doc, the V2
  mockup as `/docs`

### Days 1–3: Foundation

- Next.js 14 app scaffold
- Database schema (creators, communities, members, lessons, progress,
  flags, reports, transcripts, quotas, sessions)
- NextAuth setup (magic link via Resend)
- Encrypted credential storage (AES-256-GCM)
- Skool API client (port from recon)
- Basic settings page where creator pastes cookies
- Optional CSV member import in Settings (only surfaces if we detect
  the gap matters; powers email send list)

### Days 4–7: Drop-Off Map (Feature 1)

- Pull course data via `/courses/{course_id}` and
  `/groups/{group_id}/courses`
- Pull per-member progression
- Calculate per-lesson completion %
- Build the heatmap UI matching V2 mockup
- Add click-to-zoom interaction
- Wire up Anthropic API for AI insights, copy from wisdom doc

### Days 8–10: Community Pulse + Member Check-ins (Features 3 + 4)

- Pull `/admin-metrics` for activity time-series
- Calculate member-level activity baselines (relative to themselves,
  not absolute)
- Surface at-risk list with relationship context
- “Draft Message” button → clipboard copy + open Skool DM tab
- Today view (combined Pulse + Check-ins) matching V2 mockup
- Posts/likes tiles rendered as “coming soon” per mockup

### Days 11–13: Flashcards + Weekly Report (Features 2 + 5)

- Resend email integration
- Lesson content extraction pipeline (decision tree from Feature 2 spec)
  - PDF text extraction utility (use `pdf-parse` or similar)
  - Transcript cache table in DB (lessonId → text, with `createdAt` for
    cache invalidation)
  - Whisper API integration (OpenAI direct, audio extraction from
    video URL using stored Skool session if needed)
  - Per-creator transcription quota tracking (minutes used / minutes
    limit)
- Settings UI for creator: transcription toggle, quota display,
  “lessons we’ll skip” preview, source attribution per lesson
- Flashcard generation pipeline (Anthropic API, extracted content →
  cards, capped 3–5 cards/lesson)
- Email templates (member-facing flashcards; neutral teacher tone)
- Weekly report generation (cron job, Monday 7 AM creator local time
  using stored timezone)
- First-week welcome variant of report

### Day 14: Polish + deploy beta

- Onboarding flow
- “How to paste your cookies” walkthrough
- Deploy to Vercel
- Internal testing on Xavier’s “App Development” community
- 4–10 friendly creators (warm contacts + early ad responders) get beta
  access

### Days 15–30: Beta period

- Daily monitoring of how creators use the tool
- Weekly check-in DMs with each beta creator
- Feedback log
- v1.1 fixes based on feedback
- Begin Chrome Web Store listing for v2 extension

### Day ~30: Pre-paid-launch legal session

See Part 8.

### Day ~30–35: Founding member launch

- Open paid signups at $47/mo
- First 30 creators lock in lifetime rate (beta cohort auto-converts
  per their signup terms)
- Public launch on Xavier’s social platforms

---

## Part 10 — What Comes RIGHT After v1 Ships

In priority order, not in order of fun-ness:

1. **Chrome extension v2** (true 1-click DMs, passive member-list
   capture) — biggest UX upgrade, 4 weeks of work + Web Store review
2. **Churn Reason Tracker** — solves the “we can’t know WHY they left”
   honest gap
3. **Post Coach** — Xavier’s idea, addresses the “1–2 likes slump”
   creators hit
4. **Multi-community management** — required to unlock the Agency
   $697+ tier

---

## Part 11 — Operating Principles (the worldview)

These should constrain every decision. If a feature contradicts one,
redesign or kill.

1. **We help creators DO LESS, not more.** Every feature subtracts from
   their workload, never adds. AI Jack went 30%→5.2% churn by deleting
   content.
2. **We strengthen relationships, not surveil members.** Frame
   everything as “what to do for this person today” not “this member is
   at risk of churn.”
3. **We trust creator intuition.** We surface signals; we don’t make
   decisions for the creator.
4. **We respect Skool’s design intent.** Skool’s product philosophy:
   “show up, build relationships, have fun.” Our tool extends this,
   doesn’t fight it.
5. **We’re transparent about what we can’t know.** Drop-off but not
   why. At-risk but not certain. Honest about gaps.

---

## Part 12 — Open Questions (resolve in beta)

1. Daily vs weekly cadence for Member Check-ins — weekly digest +
   daily urgent alert is the current compromise; validate during beta.
2. How aggressive to be on “delete content” recommendations — soft
   language v1, escalate v2 based on outcome data.
3. First-week experience for empty communities (creator with 5
   members) — likely needs onboarding wisdom (intro post template,
   weekly call schedule, DM ladder reminders) instead of metrics.
4. Concrete time-to-result claim for marketing copy (Hormozi value
   equation) — emerges from beta data.

---

## Reference Documents

| File                                                                  | What it contains                                                  |
| --------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `creator-wisdom-and-product-decisions.md`                             | Extracted creator wisdom from 4 transcripts, mapped to v1 features |
| `mockups/skool-success-mockup-v2.html`                                | LOCKED design reference — visual spec                             |
| `mockups/skool-success-mockup.html`                                   | REJECTED v1 mockup, archived as “what not to do”                  |
| `decisions/`                                                          | Architectural Decision Records (ADRs)                             |
| `~/Desktop/skool-recon/skool-recon.js`                                | Working API recon code, port to v1 as `lib/skool-api/`            |

---

## Update log

- **2026-04-25:** Day 1 build kickoff. Locked database = Neon, auth =
  magic link via Resend, encryption = AES-256-GCM in Vercel env, CSV
  import surfaced in Settings (and used for member email capture),
  flashcard sourcing layered (title/description/PDF/cache → Whisper if
  opted in + quota), timezone auto-detected from browser, posts/likes
  shipped as “coming soon” tiles in Pulse. Beta cohort target: ~4–10.
  Beta creators auto-convert to founding via signup terms.
- **2026-04-24:** Full rewrite. Locked v1 features, integrated creator
  wisdom doc, locked design system V2, locked auth strategy, build
  sequence laid out day-by-day.
- **2026-04-23:** Initial master plan. Vision and market validation.
  Superseded by 2026-04-24 version.
