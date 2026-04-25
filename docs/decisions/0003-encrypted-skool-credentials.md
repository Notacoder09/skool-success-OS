# ADR-0003 — Encrypted Skool credentials (AES-256-GCM, env-managed key)

**Date:** 2026-04-25
**Status:** Accepted
**Owner:** Xavier Hines

## Context

Master plan Part 5 (Auth Strategy) locks the v1 approach: creators
paste their Skool `auth_token` (JWT) and `client_id` cookies into our
settings panel. Master plan also locks the security commitments we
publish on the landing page:

- AES-256 encryption at rest for all stored credentials
- Session tokens never logged
- Creator can rotate or revoke at any time

The key-management approach (where the master key lives) was left to
build kickoff.

## Decision

Encrypt Skool cookies with **AES-256-GCM** in application code. Master
key (`SKOOL_CREDENTIALS_ENCRYPTION_KEY`) is a 32-byte random value,
base64-encoded, stored in **Vercel environment variables** (separate
values for Preview vs Production).

- Algorithm: AES-256-GCM, 12-byte random IV per record, auth tag
  stored alongside ciphertext.
- Storage shape: `{ ciphertext, iv, authTag, keyVersion }` columns on
  the credentials row (or a single base64 blob with a documented
  layout).
- `keyVersion` (small int) supports rotation without a destructive
  migration: new writes use the latest key; reads transparently
  decrypt with whichever key matches the row’s version.
- Decryption only happens server-side, only at the moment of an
  outbound Skool API call. **Plaintext cookies never touch logs.**
- A creator-initiated **“rotate / disconnect”** action wipes the row
  and forces a fresh paste.

## Consequences

- **Easier:** zero new vendor footprint, fits the 14-day build.
- **Easier:** matches what we publish on the security page (AES-256
  at rest, rotate/revoke any time).
- **Harder:** key rotation is a manual operational step. Process:
  1. Add new key with bumped `keyVersion` to Vercel env.
  2. Background job re-encrypts all rows from old → new key.
  3. Remove old key once migration is complete and verified.
- **Operational:** never log decrypted values. Add a unit test that
  asserts our logger redacts known-sensitive field names.

## Alternatives considered

- **Cloud KMS (AWS/GCP)** — strictly better for key custody and
  auditability, but adds a vendor + IAM setup the v1 audience doesn’t
  require. Revisit at paid launch or first enterprise-flavored
  customer.
- **Per-creator derived keys** — more granular blast radius but
  significantly more code; deferred until we have evidence the simpler
  scheme is insufficient.
- **No encryption / DB-only protection** — violates the master plan’s
  locked security commitments. Hard no.
