# ADR-0004 — CSV member import (guided, optional, surfaced when needed)

**Date:** 2026-04-25
**Status:** Accepted
**Owner:** Xavier Hines

## Context

Skool API has no `/members` list endpoint. Master plan Part 4 lists
three workarounds: (1) creator uploads a CSV from Skool admin, (2)
harvest IDs from posts/comments, (3) v2 Chrome extension passively
captures IDs.

Member emails are also not reliably available from the API and are
required to send Feature 2 (flashcards) to anyone we don’t already
have an address for.

The build sequence (master plan Part 9) didn’t specify when the CSV
flow lands. Day 8–10 (when we need member-level data for Check-ins)
risks blocking Feature 4. Day 11–13 (when we need emails for
flashcards) risks blocking Feature 2.

We also explicitly want to **minimize friction** during onboarding —
no walls of forms.

## Decision

Build the CSV importer in the **foundation phase (Days 1–3)** and
expose it in two places:

1. **Onboarding:** an **optional, guided** step after the Skool cookie
   paste. Copy: “Optional — improves coverage if you have more than
   ~30 members. Takes 30 seconds.” One link to Skool admin export +
   one upload field. Skippable.
2. **Settings → Members:** always available, including a status
   readout (“We can see N of your members from Skool, plus M imported
   via CSV. Coverage: N+M / total”).

Behavior:

- **Trigger surfacing intelligence in the UI:** if after first sync we
  detect the API only sees ~30 members AND we have lessons that need
  flashcard delivery to addresses we don’t have, we show a soft
  banner pointing the creator at the import step.
- **Storage:** import populates a `members` table; emails (where
  present) flow into the flashcard send list; member IDs (where
  present) augment Skool API lookups.
- **Format flexibility:** accept Skool’s native admin export format
  first; allow column mapping for variants.
- **Dedupe:** match on Skool member ID first, then email, then name.
  Never overwrite a richer record with a thinner one.
- **GoHighLevel handoff (creator-side):** the same CSV is also useful
  in the creator’s GHL workflows. We don’t integrate with GHL in v1,
  but we keep our import/export format clean enough to round-trip.

## Consequences

- **Easier:** Feature 2 (flashcards) and Feature 4 (Check-ins) ship
  on schedule because they always have a member list to work with.
- **Easier:** matches the master plan’s “honest about gaps” principle
  — we tell the creator exactly what we can and can’t see.
- **Harder:** we own a small data-quality pipeline (parsing, dedupe,
  validation) from week one. Acceptable cost.
- **Operational:** CSV imports may include emails — we treat the
  members table as PII and apply the same care as Skool credentials
  (no logging of emails, deletion on creator request).

## Alternatives considered

- **Wait for v2 Chrome extension to harvest passively** — punts the
  problem 4+ weeks and breaks Feature 2 send-list coverage in beta.
- **Scrape posts/comments only** — lower coverage, slower to populate,
  and fragile to Skool UI changes.
- **Skip CSV, ship flashcards only to API-visible members** — leaves
  the bulk of paying creators’ communities silent in v1. Fails the
  product promise.
