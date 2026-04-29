import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isBetaEmailAllowed } from "./beta-access";

describe("isBetaEmailAllowed", () => {
  it("allows any email when the invite list is unset or empty", () => {
    assert.equal(isBetaEmailAllowed("anyone@example.com", undefined), true);
    assert.equal(isBetaEmailAllowed("anyone@example.com", "   "), true);
    assert.equal(isBetaEmailAllowed("anyone@example.com", ""), true);
  });

  it("matches comma-separated invites case-insensitively", () => {
    const list = " founder@cool.com , beta@test.io ";
    assert.equal(isBetaEmailAllowed("FOUNDER@COOL.COM", list), true);
    assert.equal(isBetaEmailAllowed("Beta@Test.Io", list), true);
    assert.equal(isBetaEmailAllowed("nope@example.com", list), false);
  });

  it("rejects whitespace-only email against a non-empty list", () => {
    assert.equal(isBetaEmailAllowed("   ", "a@b.com"), false);
  });
});
