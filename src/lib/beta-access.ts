// Beta invite gate (Day 14 polish). No UI feature — env-only.
//
// When `BETA_INVITE_EMAILS` is unset or empty, magic-link sign-in works
// for any address (open access). When set, it must be a comma-separated
// list of emails; only those addresses receive a sign-in link.
//
// Parsing defends common production mistakes:
// – Entire env value wrapped in ASCII quotes (`"user@domain.com"`).
// – Per-entry quotes after splitting.
// – UTF-8 BOM on the envelope (some editors/export tools prepend it).

function stripBom(value: string): string {
  return value.startsWith("\uFEFF") ? value.slice(1) : value;
}

/** Strip one matching pair of surrounding ' or " (typical pasted env values). */
function stripAsciiQuotesOnce(value: string): string {
  const s = stripBom(value).trim();
  if (s.length < 2) return s;
  const a = s[0];
  const b = s[s.length - 1];
  const quotePair =
    (a === '"' && b === '"') || (a === "'" && b === "'");
  return quotePair ? s.slice(1, -1).trim() : s;
}

/** Repeatedly unwrap outer quotes until stable (handles double-wrapped pasted values). */
function unwrapQuotedEnvelope(raw: string): string {
  let prev = stripBom(raw).trim();
  for (let i = 0; i < 5; i += 1) {
    const next = stripAsciiQuotesOnce(prev);
    if (next === prev) break;
    prev = next;
  }
  return prev;
}

/** Build the allow-set from a raw env string. */
function inviteEmailSet(inviteListEnv: string): Set<string> {
  const envelope = unwrapQuotedEnvelope(inviteListEnv);
  const set = new Set<string>();
  for (const part of envelope.split(",")) {
    const email = unwrapQuotedEnvelope(part);
    if (!email) continue;
    set.add(email.toLowerCase());
  }
  return set;
}

/**
 * Whether this email may request a magic link. Case-insensitive against
 * `BETA_INVITE_EMAILS`; pass `process.env.BETA_INVITE_EMAILS` when
 * testing deterministically.
 */
export function isBetaEmailAllowed(
  email: string,
  inviteListEnv: string | undefined = process.env.BETA_INVITE_EMAILS,
): boolean {
  const envelope = unwrapQuotedEnvelope(inviteListEnv ?? "");
  if (!envelope) return true;
  const normalizedInput = unwrapQuotedEnvelope(email.trim()).toLowerCase();
  if (!normalizedInput) return false;
  const allowed = inviteEmailSet(inviteListEnv ?? "");
  return allowed.has(normalizedInput);
}
