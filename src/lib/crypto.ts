import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from "node:crypto";

// ADR-0003: AES-256-GCM at rest for Skool session credentials.
// - 32-byte key, base64 encoded, lives in Vercel env
// - 12-byte random IV per record
// - 16-byte auth tag stored alongside ciphertext
// - keyVersion supports rotation without a destructive migration
//
// Plaintext NEVER touches logs. The redaction helper at the bottom
// of this file is the only thing approved to render decrypted material
// for debugging.

const ALGO = "aes-256-gcm";
const KEY_BYTES = 32;
const IV_BYTES = 12;

export type EncryptedBlob = {
  /** base64 ciphertext */
  ciphertext: string;
  /** base64 IV (12 bytes) */
  iv: string;
  /** base64 GCM auth tag (16 bytes) */
  authTag: string;
  /** which key encrypted this row (lookup via SKOOL_CREDENTIALS_KEY_v{N}) */
  keyVersion: number;
};

export class CryptoConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CryptoConfigError";
  }
}

export class DecryptionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DecryptionError";
  }
}

/**
 * Resolve the encryption key for a given version. v1 lives at
 * SKOOL_CREDENTIALS_ENCRYPTION_KEY for ergonomics; v2+ live at
 * SKOOL_CREDENTIALS_KEY_v2, _v3, etc.
 *
 * Rotation procedure (documented in ADR-0003):
 *   1. Generate a new key, set SKOOL_CREDENTIALS_KEY_v{N+1} in Vercel env.
 *   2. Bump SKOOL_CREDENTIALS_KEY_VERSION to N+1 (new writes use it).
 *   3. Run `tsx scripts/rotate-skool-keys.ts` to re-encrypt every row.
 *   4. Once verified, remove the old key env var.
 */
function resolveKey(version: number): Buffer {
  const envName =
    version === 1
      ? "SKOOL_CREDENTIALS_ENCRYPTION_KEY"
      : `SKOOL_CREDENTIALS_KEY_v${version}`;
  const raw = process.env[envName];
  if (!raw) {
    throw new CryptoConfigError(
      `Missing key for version ${version}. Expected env var ${envName}.`,
    );
  }
  const key = Buffer.from(raw, "base64");
  if (key.length !== KEY_BYTES) {
    throw new CryptoConfigError(
      `${envName} must decode to exactly 32 bytes (got ${key.length}). ` +
        `Generate with: openssl rand -base64 32`,
    );
  }
  return key;
}

function currentKeyVersion(): number {
  const raw = process.env.SKOOL_CREDENTIALS_KEY_VERSION ?? "1";
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new CryptoConfigError(
      `SKOOL_CREDENTIALS_KEY_VERSION must be a positive integer, got "${raw}".`,
    );
  }
  return parsed;
}

export function encrypt(plaintext: string): EncryptedBlob {
  const version = currentKeyVersion();
  const key = resolveKey(version);
  const iv = randomBytes(IV_BYTES);

  const cipher = createCipheriv(ALGO, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    authTag: authTag.toString("base64"),
    keyVersion: version,
  };
}

export function decrypt(blob: EncryptedBlob): string {
  const key = resolveKey(blob.keyVersion);
  const iv = Buffer.from(blob.iv, "base64");
  const authTag = Buffer.from(blob.authTag, "base64");
  const ciphertext = Buffer.from(blob.ciphertext, "base64");

  if (iv.length !== IV_BYTES) {
    throw new DecryptionError(`IV must be ${IV_BYTES} bytes, got ${iv.length}.`);
  }

  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(authTag);
  try {
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return plaintext.toString("utf8");
  } catch (err) {
    // GCM tag mismatch indicates tampered ciphertext, wrong IV, or wrong key.
    // Re-throw with a generic message so we never leak which one failed.
    throw new DecryptionError(
      `Failed to decrypt payload (key v${blob.keyVersion}). Tampered or wrong key.`,
    );
  }
}

// --- Skool credential payload --------------------------------------------

// Master plan Part 5: stored shape is auth_token (JWT) + client_id.
export type SkoolCookies = {
  authToken: string;
  clientId: string;
};

const SKOOL_PAYLOAD_VERSION = 1;

export function serializeSkoolCookies(cookies: SkoolCookies): string {
  if (!cookies.authToken || !cookies.clientId) {
    throw new Error("Both authToken and clientId are required.");
  }
  return JSON.stringify({ v: SKOOL_PAYLOAD_VERSION, ...cookies });
}

export function parseSkoolCookies(plaintext: string): SkoolCookies {
  const parsed = JSON.parse(plaintext) as Partial<SkoolCookies & { v?: number }>;
  if (parsed.v !== SKOOL_PAYLOAD_VERSION) {
    throw new Error(`Unknown Skool payload version: ${parsed.v ?? "(none)"}.`);
  }
  if (!parsed.authToken || !parsed.clientId) {
    throw new Error("Decrypted Skool payload is missing required fields.");
  }
  return { authToken: parsed.authToken, clientId: parsed.clientId };
}

// --- Constant-time compare for token-like values -------------------------

export function safeEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return timingSafeEqual(aBuf, bBuf);
}

// --- Log redaction --------------------------------------------------------

const SENSITIVE_KEYS = new Set([
  "authToken",
  "auth_token",
  "clientId",
  "client_id",
  "ciphertext",
  "iv",
  "authTag",
  "auth_tag",
  "password",
  "secret",
  "token",
  "key",
]);

/**
 * Recursively redact any field whose key matches a known-sensitive name.
 * Use before logging any object that *might* have brushed against
 * decrypted credentials.
 */
export function redact<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((v) => redact(v)) as unknown as T;
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SENSITIVE_KEYS.has(k) ? "[REDACTED]" : redact(v);
    }
    return out as unknown as T;
  }
  return value;
}
