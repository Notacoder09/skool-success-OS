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

  it("tolerates double-quoted env entries (common in hosting UIs)", () => {
    const list = '"you@example.com"';
    assert.equal(isBetaEmailAllowed("you@example.com", list), true);
    assert.equal(isBetaEmailAllowed("YOu@EXAMPLE.com", list), true);
  });

  it("strips quotes around the entire comma-separated env value", () => {
    const list = '"a@one.com, b@two.com "';
    assert.equal(isBetaEmailAllowed("a@one.com", list), true);
    assert.equal(isBetaEmailAllowed("b@two.com", list), true);
  });
});
