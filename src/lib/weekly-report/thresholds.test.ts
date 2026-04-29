import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  classifyRetention,
  DAY_90_MILESTONE,
  MAX_ACTIONS_PER_REPORT,
  RETENTION_BAD,
  RETENTION_GOOD,
  RETENTION_PLATFORM_AVG,
} from "./thresholds";

describe("retention thresholds", () => {
  it("matches the wisdom-doc table values", () => {
    assert.equal(RETENTION_PLATFORM_AVG, 0.8);
    assert.equal(RETENTION_GOOD, 0.9);
    assert.equal(RETENTION_BAD, 0.7);
  });

  it("flags day 90 and the action cap", () => {
    assert.equal(DAY_90_MILESTONE, 90);
    assert.equal(MAX_ACTIONS_PER_REPORT, 3);
  });
});

describe("classifyRetention", () => {
  it("returns 'unknown' when no data", () => {
    assert.equal(classifyRetention(null).tone, "unknown");
  });

  it("classifies >= 90% as 'good'", () => {
    assert.equal(classifyRetention(0.95).tone, "good");
    assert.equal(classifyRetention(0.9).tone, "good");
  });

  it("classifies 80-89% as 'average'", () => {
    assert.equal(classifyRetention(0.85).tone, "average");
    assert.equal(classifyRetention(0.8).tone, "average");
  });

  it("classifies 70-79% as 'below'", () => {
    assert.equal(classifyRetention(0.79).tone, "below");
    assert.equal(classifyRetention(0.7).tone, "below");
  });

  it("classifies < 70% as 'bad'", () => {
    assert.equal(classifyRetention(0.69).tone, "bad");
    assert.equal(classifyRetention(0.5).tone, "bad");
  });

  it("references the 80% benchmark in 'below' copy", () => {
    assert.match(classifyRetention(0.75).copy, /80%/);
  });

  it("references 70% in 'bad' copy", () => {
    assert.match(classifyRetention(0.6).copy, /70%/);
  });
});
