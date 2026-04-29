// Beta invite gate (Day 14 polish). No UI feature — env-only.
//
// When `BETA_INVITE_EMAILS` is unset or empty, magic-link sign-in works
// for any address (open access). When set, it must be a comma-separated
// list of lowercase emails; only those addresses receive a sign-in link.

/**
 * Whether this email may request a magic link. Case-insensitive against
 * `BETA_INVITE_EMAILS`; pass `process.env.BETA_INVITE_EMAILS` when
 * testing deterministically.
 */
export function isBetaEmailAllowed(
  email: string,
  inviteListEnv: string | undefined = process.env.BETA_INVITE_EMAILS,
): boolean {
  const raw = inviteListEnv?.trim();
  if (!raw) return true;
  const normalized = email.trim().toLowerCase();
  if (!normalized) return false;
  const allowed = new Set(
    raw
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  );
  return allowed.has(normalized);
}
