import "server-only";

import { eq } from "drizzle-orm";

import { db } from "@/db";
import { skoolCredentials } from "@/db/schema/creators";
import { decrypt, parseSkoolCookies, type SkoolCookies } from "@/lib/crypto";

// Decrypt the Skool session cookies for a given creator. Server-only:
// the `import "server-only"` above makes Next.js refuse to bundle this
// into any client component.
//
// CRITICAL: never call this from a "use server" file. Functions
// exported from "use server" files are auto-exposed as POST endpoints
// callable by anyone with a session, which would let any signed-in
// user pass any creator ID and decrypt that creator's cookies. This
// helper has no authorization step of its own — callers MUST pass a
// creator ID they've already authorized (e.g. derived from the
// session, not from request input).
//
// Returns null if there are no credentials, the row is non-active,
// or decryption fails (e.g. key rotation gap). Never throws on the
// decryption path so misuse can't leak via error messages.
export async function loadDecryptedCookiesForCreator(
  creatorId: string,
): Promise<SkoolCookies | null> {
  const [row] = await db
    .select()
    .from(skoolCredentials)
    .where(eq(skoolCredentials.creatorId, creatorId));
  if (!row || row.status !== "active") return null;

  try {
    const plaintext = decrypt({
      ciphertext: row.ciphertext,
      iv: row.iv,
      authTag: row.authTag,
      keyVersion: row.keyVersion,
    });
    return parseSkoolCookies(plaintext);
  } catch {
    return null;
  }
}
