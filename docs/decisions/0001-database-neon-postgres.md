# ADR-0001 — Database: Neon Postgres

**Date:** 2026-04-25
**Status:** Accepted
**Owner:** Xavier Hines

## Context

Master plan Part 4 specifies Postgres and explicitly defers the
hosting choice (“Supabase or Neon — pick during build kickoff based on
free-tier generosity right now”).

We need:

- A real Postgres (not a wrapper) so migrations and SQL stay portable.
- Cheap-to-zero idle cost for the beta period (~4–10 creators, mostly
  reads + occasional cron writes).
- A serverless-friendly driver that plays well with Next.js 14 on
  Vercel (App Router + edge/server actions). Connection storms from
  serverless are a known foot-gun on classic pooled Postgres.
- Headroom to add Drizzle for typed queries and migrations.

## Decision

Use **Neon Postgres** with Neon’s **HTTP/serverless driver** for
request-time queries, and a pooled connection string for long-running
jobs (cron, transcription pipeline).

## Consequences

- **Easier:** scale-to-zero cost during beta, branch-per-migration
  workflow, native serverless-driver path that avoids connection-pool
  exhaustion on Vercel.
- **Easier:** one product surface (Postgres + branching). Mental model
  stays “just Postgres.”
- **Harder:** if we later want hosted auth, realtime, or storage in
  one vendor, we’d migrate to Supabase or stitch services together.
  Acceptable for v1 since auth is NextAuth and email/storage live
  elsewhere (Resend, S3 only if we ever need it).
- **Operational:** keep the connection string in Vercel env; use the
  HTTP driver for app code, the pooled `postgres://` for cron jobs and
  `drizzle-kit` migrations.

## Alternatives considered

- **Supabase** — fine product, but bundles auth/realtime/storage we
  don’t need in v1 (we’re using NextAuth + Resend), and the
  serverless driver story is less direct than Neon’s.
- **Vercel Postgres (Neon-backed)** — wraps Neon. Would lock us
  tighter to Vercel billing without buying us anything Neon doesn’t
  give us directly.
- **Self-hosted Postgres on Fly/Render** — too much ops for a 14-day
  build with a one-person team.
