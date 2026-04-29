import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  draftAllTones,
  draftMessage,
  firstNameFrom,
  TONES,
} from "./templates";
import type { MemberRiskFlag } from "./at-risk";

const flag = (kind: MemberRiskFlag["reasonKind"]): MemberRiskFlag => ({
  memberId: "m1",
  reasonKind: kind,
  reason: "irrelevant for tests",
  daysSinceActive: 14,
  tenureDays: 90,
});

describe("firstNameFrom", () => {
  it("returns the first token of a multi-word name", () => {
    assert.equal(firstNameFrom("Bill T"), "Bill");
    assert.equal(firstNameFrom("Mary Anne Smith"), "Mary");
  });

  it("returns null for empty/whitespace", () => {
    assert.equal(firstNameFrom(null), null);
    assert.equal(firstNameFrom(""), null);
    assert.equal(firstNameFrom("   "), null);
  });
});

describe("draftMessage — sam", () => {
  it("includes the first name in the body when known", () => {
    const out = draftMessage({
      tone: "sam",
      firstName: "Bill",
      reasonKind: "stalled_mid_course",
    });
    assert.match(out, /Bill, sup/);
  });

  it("omits the name placeholder when first name is null", () => {
    const out = draftMessage({
      tone: "sam",
      firstName: null,
      reasonKind: "stalled_mid_course",
    });
    assert.equal(out, "sup — how's everything going?");
  });

  it("is short (Sam style: 'sup')", () => {
    const out = draftMessage({
      tone: "sam",
      firstName: "Bill",
      reasonKind: "stalled_mid_course",
    });
    assert.ok(out.length < 60, `Sam style should stay short, got ${out.length}`);
  });
});

describe("draftMessage — hamza", () => {
  it("uses the warmer 'saw you haven't been around' open", () => {
    const out = draftMessage({
      tone: "hamza",
      firstName: "Bill",
      reasonKind: "tenure_dropoff",
    });
    assert.match(out, /haven't been around/);
    assert.match(out, /Bill/);
  });
});

describe("draftMessage — professional", () => {
  it("varies the tail by reason kind", () => {
    const stalled = draftMessage({
      tone: "professional",
      firstName: "Bill",
      reasonKind: "stalled_mid_course",
    });
    const dropoff = draftMessage({
      tone: "professional",
      firstName: "Bill",
      reasonKind: "tenure_dropoff",
    });
    const ghost = draftMessage({
      tone: "professional",
      firstName: "Bill",
      reasonKind: "brand_new_ghost",
    });
    assert.notEqual(stalled, dropoff);
    assert.notEqual(dropoff, ghost);
    assert.match(stalled, /stuck on a lesson/);
    assert.match(ghost, /start felt overwhelming/);
  });

  it("greets by first name when known", () => {
    const out = draftMessage({
      tone: "professional",
      firstName: "Bill",
      reasonKind: "stalled_mid_course",
    });
    assert.match(out, /^Hey Bill,/);
  });

  it("greets generically when first name is missing", () => {
    const out = draftMessage({
      tone: "professional",
      firstName: null,
      reasonKind: "stalled_mid_course",
    });
    assert.match(out, /^Hey,/);
  });
});

describe("draftAllTones", () => {
  it("returns one draft per tone", () => {
    const all = draftAllTones({
      firstName: "Bill",
      flag: flag("stalled_mid_course"),
    });
    for (const tone of TONES) {
      assert.ok(typeof all[tone] === "string" && all[tone].length > 0);
    }
  });
});
