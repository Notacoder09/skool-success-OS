# ADR-0002 — Auth: NextAuth magic link via Resend

**Date:** 2026-04-25
**Status:** Accepted
**Owner:** Xavier Hines

## Context

Master plan Part 4 locks **NextAuth.js** for our app login and locks
**Resend** as the email provider for transactional/flashcards/weekly
reports. The provider strategy inside NextAuth was not specified.

Constraints:

- Audience is creators (small, ~4–10 in beta, ~30 at founding launch).
- We already pay for and use Resend.
- We want zero password ops (no resets, no leaks, no support tickets
  for forgotten passwords).
- Onboarding has enough friction already (paste Skool cookies + maybe
  CSV import). Sign-in itself must not add friction.

## Decision

Use NextAuth (Auth.js) with **email magic link** as the sole sign-in
method for creators in v1. Send the link via Resend (using
`@auth/core/providers/email` with a custom `sendVerificationRequest`
that calls the Resend SDK and uses our React Email template).

Members do **not** authenticate to our app — they receive
flashcard/weekly emails only.

## Consequences

- **Easier:** no password storage, no reset flows, no support load.
  One email = sign in. Pairs with Resend we already pay for.
- **Easier:** consistent “check your inbox” pattern across signup +
  login.
- **Harder:** users on shared inboxes / corporate filters can have
  link delivery issues — we’ll monitor bounces in Resend dashboard
  and add Google OAuth as a Phase 2 option if it becomes a real
  problem in beta.
- **Operational:** session strategy = JWT (default), cookie name
  scoped to our domain. Magic link TTL = 10 minutes. Single-use.

## Alternatives considered

- **Email + password** — adds password ops (resets, breaches, support).
  No upside for our audience size.
- **Google OAuth only** — fast for Google users, blocks anyone
  (Outlook, ProtonMail, etc.). Not appropriate as the only option.
- **Skool OAuth / SSO** — Skool doesn’t offer it; we can’t depend on
  a partnership the master plan explicitly says we don’t have.
- **Magic link + Google OAuth from day 1** — fine, but adds UI surface
  area. Defer to Phase 2 if magic link causes friction in beta.
