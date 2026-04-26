import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  computeLessonCompletionPct,
  toneForCompletion,
} from "./aggregation";

describe("computeLessonCompletionPct", () => {
  it("returns null when totalMembers is 0", () => {
    assert.equal(
      computeLessonCompletionPct({ totalMembers: 0, completed: 0 }),
      null,
    );
  });

  it("returns 100 when everyone completed", () => {
    assert.equal(
      computeLessonCompletionPct({ totalMembers: 4, completed: 4 }),
      100,
    );
  });

  it("returns 0 when nobody completed", () => {
    assert.equal(
      computeLessonCompletionPct({ totalMembers: 4, completed: 0 }),
      0,
    );
  });

  it("rounds to two decimal places", () => {
    assert.equal(
      computeLessonCompletionPct({ totalMembers: 3, completed: 2 }),
      66.67,
    );
  });

  it("caps at 100 if completed somehow exceeds total", () => {
    assert.equal(
      computeLessonCompletionPct({ totalMembers: 3, completed: 5 }),
      100,
    );
  });

  it("clamps negative completed to 0", () => {
    assert.equal(
      computeLessonCompletionPct({ totalMembers: 3, completed: -1 }),
      0,
    );
  });
});

describe("toneForCompletion", () => {
  it("returns 'unknown' for null", () => {
    assert.equal(toneForCompletion(null), "unknown");
  });
  it("returns 'healthy' at 75% and above", () => {
    assert.equal(toneForCompletion(75), "healthy");
    assert.equal(toneForCompletion(99.9), "healthy");
    assert.equal(toneForCompletion(100), "healthy");
  });
  it("returns 'warm' between 50 and 75", () => {
    assert.equal(toneForCompletion(50), "warm");
    assert.equal(toneForCompletion(74.99), "warm");
  });
  it("returns 'leak' below 50", () => {
    assert.equal(toneForCompletion(49.99), "leak");
    assert.equal(toneForCompletion(0), "leak");
  });
});
