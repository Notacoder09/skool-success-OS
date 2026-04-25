import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, it } from "node:test";

import {
  CryptoConfigError,
  DecryptionError,
  decrypt,
  encrypt,
  parseSkoolCookies,
  redact,
  serializeSkoolCookies,
} from "./crypto";

const KEY_V1 = randomBytes(32).toString("base64");
const KEY_V2 = randomBytes(32).toString("base64");

function setEnv(env: Record<string, string | undefined>) {
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

describe("crypto.encrypt / decrypt", () => {
  const original: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of [
      "SKOOL_CREDENTIALS_ENCRYPTION_KEY",
      "SKOOL_CREDENTIALS_KEY_VERSION",
      "SKOOL_CREDENTIALS_KEY_v2",
    ]) {
      original[k] = process.env[k];
    }
    setEnv({
      SKOOL_CREDENTIALS_ENCRYPTION_KEY: KEY_V1,
      SKOOL_CREDENTIALS_KEY_VERSION: "1",
      SKOOL_CREDENTIALS_KEY_v2: undefined,
    });
  });

  afterEach(() => {
    setEnv(original);
  });

  it("roundtrips plaintext through current key", () => {
    const plain = serializeSkoolCookies({ authToken: "jwt.abc.def", clientId: "client-123" });
    const blob = encrypt(plain);

    assert.equal(blob.keyVersion, 1);
    assert.notEqual(blob.ciphertext, plain);
    assert.ok(blob.iv.length > 0);
    assert.ok(blob.authTag.length > 0);

    const decoded = decrypt(blob);
    assert.equal(decoded, plain);
    assert.deepEqual(parseSkoolCookies(decoded), {
      authToken: "jwt.abc.def",
      clientId: "client-123",
    });
  });

  it("rejects tampered ciphertext via GCM auth tag", () => {
    const blob = encrypt("hello world");
    // Flip a byte in the ciphertext.
    const tampered = { ...blob, ciphertext: flipByte(blob.ciphertext) };
    assert.throws(() => decrypt(tampered), DecryptionError);
  });

  it("rejects tampered auth tag", () => {
    const blob = encrypt("hello world");
    const tampered = { ...blob, authTag: flipByte(blob.authTag) };
    assert.throws(() => decrypt(tampered), DecryptionError);
  });

  it("decrypts old-version rows after key rotation", () => {
    const oldBlob = encrypt("from before rotation");

    setEnv({
      SKOOL_CREDENTIALS_KEY_v2: KEY_V2,
      SKOOL_CREDENTIALS_KEY_VERSION: "2",
    });

    const newBlob = encrypt("after rotation");
    assert.equal(newBlob.keyVersion, 2);
    assert.equal(decrypt(newBlob), "after rotation");

    assert.equal(decrypt(oldBlob), "from before rotation");
  });

  it("errors clearly when current key is missing", () => {
    setEnv({ SKOOL_CREDENTIALS_ENCRYPTION_KEY: undefined });
    assert.throws(() => encrypt("anything"), CryptoConfigError);
  });

  it("errors clearly when key length is wrong", () => {
    setEnv({ SKOOL_CREDENTIALS_ENCRYPTION_KEY: Buffer.from("too short").toString("base64") });
    assert.throws(() => encrypt("anything"), CryptoConfigError);
  });
});

describe("crypto.redact", () => {
  it("redacts top-level sensitive keys", () => {
    const out = redact({ authToken: "jwt", clientId: "id", note: "kept" });
    assert.deepEqual(out, { authToken: "[REDACTED]", clientId: "[REDACTED]", note: "kept" });
  });

  it("recurses into nested objects and arrays", () => {
    const out = redact({
      cred: { auth_token: "jwt", iv: "abc" },
      list: [{ token: "x" }, { ok: true }],
    });
    assert.deepEqual(out, {
      cred: { auth_token: "[REDACTED]", iv: "[REDACTED]" },
      list: [{ token: "[REDACTED]" }, { ok: true }],
    });
  });

  it("leaves primitives alone", () => {
    assert.equal(redact("plain string"), "plain string");
    assert.equal(redact(42), 42);
    assert.equal(redact(null), null);
  });
});

function flipByte(b64: string): string {
  const buf = Buffer.from(b64, "base64");
  buf[0] = (buf[0]! ^ 0xff) & 0xff;
  return buf.toString("base64");
}
