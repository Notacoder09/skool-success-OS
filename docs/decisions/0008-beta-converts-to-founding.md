# ADR-0008 — Beta cohort auto-converts to founding tier

**Date:** 2026-04-25
**Status:** Accepted
**Owner:** Xavier Hines

## Context

Master plan locks two facts:

- ~4–10 free beta creators for 30 days starting around Day 14.
- First 30 paying creators get the **$47/mo lifetime founding rate**.

Open question: do beta creators have to actively re-sign with a card
at end of beta, or do they convert automatically? Xavier’s direction:
**automatic conversion**, framed in the signup terms like a free
trial.

## Decision

- Beta access is granted with a clear signup agreement that doubles
  as the conversion contract: “Free for 30 days. After that, you
  auto-convert to our founding member rate of **$47/mo lifetime**
  unless you cancel before then.”
- Beta creators get a `cohort = 'beta'` tag and a `founding_eligible
  = true` flag on the creators row from day one.
- ~Day 25 (T-5): we send a heads-up email — “Your founding rate
  starts in 5 days, here’s how to add a card or cancel.”
- ~Day 30: Stripe charge attempt. Successful charge → tier becomes
  `founding`, rate locked for life. Failed/declined → graceful
  pause: access is paused (not deleted), creator gets one nudge to
  update card, then a clean offboard with data export.
- Beta seats consume founding slots. The “first 30” counter starts
  filled by beta cohort + early ad responders.

## Consequences

- **Easier:** removes a manual sales motion right at the moment
  creators are deepest in the product.
- **Easier:** founding-rate scarcity is real (cohort + early
  responders count against the 30 cap).
- **Harder:** the conversion email + Stripe wiring must be solid by
  ~Day 25. Stripe is otherwise deferred to pre-paid-launch; this
  pulls the minimum Stripe surface (one product, one price, one
  trial-style subscription) earlier than originally planned.
- **Operational:** signup ToS must be unambiguous about
  auto-conversion and the cancellation path. Legal session on Day ~30
  reviews this exact language before opening it to non-beta paid
  signups.

## Alternatives considered

- **Beta creators must actively re-sign** — adds friction at the
  worst moment and hurts conversion of users who already love the
  product.
- **Beta is fully free forever** — kills the founding-rate marketing
  asset and burns the most engaged cohort’s willingness to pay.
- **Convert at full $97 Starter** — breaks the implicit “you’re an
  early believer” promise of the beta.
