import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { findLargestCliff, formatCliff, type CliffLesson } from "./cliffs";

const L = (
  position: number,
  completionPct: number | null,
  title = `Lesson ${position}`,
): CliffLesson => ({ id: `id-${position}`, position, title, completionPct });

describe("findLargestCliff", () => {
  it("returns null when there are fewer than 2 lessons", () => {
    assert.equal(findLargestCliff([]), null);
    assert.equal(findLargestCliff([L(1, 50)]), null);
  });

  it("returns null when no two consecutive lessons both have data", () => {
    const lessons = [L(1, 100), L(2, null), L(3, null), L(4, 33)];
    assert.equal(findLargestCliff(lessons), null);
  });

  it("returns null when the course only goes up", () => {
    const lessons = [L(1, 50), L(2, 60), L(3, 80), L(4, 90)];
    assert.equal(findLargestCliff(lessons), null);
  });

  it("matches the V2 mockup: prefers the transition that crosses into the leak zone", () => {
    // L1=100, L2=66, L3=33, L4=33 — the same numbers as the mockup.
    // 1→2 has a slightly larger absolute drop (34) than 2→3 (33), but
    // 2→3 is the meaningful leak: it crosses from healthy (>=50%) into
    // leaking (<50%). Wisdom-doc threshold wins over raw magnitude.
    const lessons = [L(1, 100), L(2, 66), L(3, 33), L(4, 33)];
    const cliff = findLargestCliff(lessons);
    assert.ok(cliff);
    assert.equal(cliff!.from.position, 2);
    assert.equal(cliff!.to.position, 3);
    assert.equal(cliff!.delta, 33);
  });

  it("falls back to largest overall drop when no transition lands in the leak zone", () => {
    const lessons = [L(1, 100), L(2, 90), L(3, 70), L(4, 60)];
    const cliff = findLargestCliff(lessons);
    assert.ok(cliff);
    // 2→3 drops 20 points; biggest of the bunch but never enters
    // the leak zone (70% is still healthy-ish).
    assert.equal(cliff!.from.position, 2);
    assert.equal(cliff!.to.position, 3);
    assert.equal(cliff!.delta, 20);
  });

  it("breaks ties in favour of the earlier transition (early-drop wisdom)", () => {
    // Two equal 30-point drops with destinations both above 50%.
    const lessons = [L(1, 90), L(2, 60), L(3, 90), L(4, 60)];
    const cliff = findLargestCliff(lessons);
    assert.ok(cliff);
    assert.equal(cliff!.from.position, 1);
    assert.equal(cliff!.to.position, 2);
  });

  it("ignores upward transitions when looking for leaks", () => {
    const lessons = [L(1, 50), L(2, 80), L(3, 40), L(4, 90)];
    const cliff = findLargestCliff(lessons);
    assert.ok(cliff);
    assert.equal(cliff!.from.position, 2);
    assert.equal(cliff!.to.position, 3);
    assert.equal(cliff!.delta, 40);
  });

  it("survives positions that are non-contiguous (Skool reorder edits)", () => {
    const lessons = [L(5, 20), L(1, 100), L(3, 80)];
    const cliff = findLargestCliff(lessons);
    assert.ok(cliff);
    // After sorting: 1 (100) → 3 (80) → 5 (20). 3→5 drops into the
    // leak zone (20%) AND has the biggest delta — both rules agree.
    assert.equal(cliff!.from.position, 3);
    assert.equal(cliff!.to.position, 5);
    assert.equal(cliff!.delta, 60);
  });
});

describe("formatCliff", () => {
  it("formats as 'L2 → L3 (66% → 33%)'", () => {
    const cliff = findLargestCliff([L(1, 100), L(2, 66), L(3, 33)]);
    assert.equal(formatCliff(cliff), "L2 → L3 (66% → 33%)");
  });

  it("returns null when no cliff exists", () => {
    assert.equal(formatCliff(null), null);
  });
});
