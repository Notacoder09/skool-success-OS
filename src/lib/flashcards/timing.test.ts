import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildSendIdempotencyKey,
  filterDueCompletions,
  isInSendWindow,
  SEND_WINDOW_LOWER_HOURS,
  SEND_WINDOW_UPPER_HOURS,
} from "./timing";

const HOUR = 3_600_000;
const NOW = new Date("2026-04-28T12:00:00Z");

describe("isInSendWindow", () => {
  it("rejects completions younger than the lower bound", () => {
    const completedAt = new Date(NOW.getTime() - 23 * HOUR);
    assert.equal(isInSendWindow(completedAt, NOW), false);
  });

  it("accepts at exactly the lower bound", () => {
    const completedAt = new Date(NOW.getTime() - 24 * HOUR);
    assert.equal(isInSendWindow(completedAt, NOW), true);
  });

  it("accepts inside the window", () => {
    const completedAt = new Date(NOW.getTime() - 36 * HOUR);
    assert.equal(isInSendWindow(completedAt, NOW), true);
  });

  it("rejects at or beyond the upper bound", () => {
    const at = new Date(NOW.getTime() - 48 * HOUR);
    const beyond = new Date(NOW.getTime() - 49 * HOUR);
    assert.equal(isInSendWindow(at, NOW), false);
    assert.equal(isInSendWindow(beyond, NOW), false);
  });

  it("constants match the wisdom doc 24-48h spec", () => {
    assert.equal(SEND_WINDOW_LOWER_HOURS, 24);
    assert.equal(SEND_WINDOW_UPPER_HOURS, 48);
  });
});

describe("filterDueCompletions", () => {
  const completions = [
    {
      memberId: "m1",
      lessonId: "l1",
      completedAt: new Date(NOW.getTime() - 12 * HOUR),
    }, // too young
    {
      memberId: "m2",
      lessonId: "l2",
      completedAt: new Date(NOW.getTime() - 30 * HOUR),
    }, // due
    {
      memberId: "m3",
      lessonId: "l3",
      completedAt: new Date(NOW.getTime() - 26 * HOUR),
    }, // due (older first after sort, but younger than m2)
    {
      memberId: "m4",
      lessonId: "l4",
      completedAt: new Date(NOW.getTime() - 72 * HOUR),
    }, // too old
  ];

  it("keeps only entries inside the window", () => {
    const out = filterDueCompletions(completions, NOW);
    assert.equal(out.length, 2);
    assert.deepEqual(
      out.map((c) => c.memberId).sort(),
      ["m2", "m3"],
    );
  });

  it("returns oldest first (so cron processes oldest when truncating)", () => {
    const out = filterDueCompletions(completions, NOW);
    assert.equal(out[0]?.memberId, "m2");
    assert.equal(out[1]?.memberId, "m3");
  });
});

describe("buildSendIdempotencyKey", () => {
  it("is deterministic for the same (member, lesson) pair", () => {
    assert.equal(
      buildSendIdempotencyKey("m1", "l1"),
      buildSendIdempotencyKey("m1", "l1"),
    );
  });
  it("differs across pairs", () => {
    assert.notEqual(
      buildSendIdempotencyKey("m1", "l1"),
      buildSendIdempotencyKey("m1", "l2"),
    );
    assert.notEqual(
      buildSendIdempotencyKey("m1", "l1"),
      buildSendIdempotencyKey("m2", "l1"),
    );
  });
});
