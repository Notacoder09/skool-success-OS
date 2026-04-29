import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildFallbackInsight,
  generateCourseDropOffInsight,
  INSIGHT_FALLBACK_MODEL,
  type InsightInput,
} from "./insights";

// Tests focus on the fallback path because that's the deterministic
// surface and the one beta creators will see until ANTHROPIC_API_KEY
// is configured. Anthropic-backed generation is tested by integration
// (live key required) — covered manually during Day 14 polish.

const baseInput: InsightInput = {
  courseTitle: "meme",
  courseLessonCount: 4,
  memberCount: 3,
  worstPosition: 3,
  worstTitle: "New page",
  worstCompletionPct: 33.33,
  previousPosition: 2,
  previousTitle: "trails",
  previousCompletionPct: 66.67,
  nextPosition: 4,
  nextTitle: "title",
  nextCompletionPct: 33.33,
};

describe("buildFallbackInsight", () => {
  it("highlights the lesson title with bold markdown", () => {
    const out = buildFallbackInsight(baseInput);
    assert.match(out, /\*\*Lesson 3 — New page\*\*/);
  });

  it("uses the early-course shape when worst lesson is in the first third", () => {
    const out = buildFallbackInsight({
      ...baseInput,
      worstPosition: 1,
      worstTitle: "Intro",
      previousPosition: null,
      previousTitle: null,
      previousCompletionPct: null,
      worstCompletionPct: 30,
      courseLessonCount: 6,
    });
    assert.match(out, /Andrew Kirby/);
    assert.match(out, /\*\*Lesson 1 — Intro\*\*/);
  });

  it("uses the cliff shape when there's a >=15 point drop from the previous lesson", () => {
    const out = buildFallbackInsight({
      ...baseInput,
      worstPosition: 4,
      courseLessonCount: 6,
      worstCompletionPct: 40,
      previousCompletionPct: 80,
    });
    assert.match(out, /AI Jack/);
    assert.match(out, /points/);
  });

  it("falls back to the honest-uncertainty shape otherwise", () => {
    const out = buildFallbackInsight({
      ...baseInput,
      worstPosition: 4,
      courseLessonCount: 6,
      worstCompletionPct: 60,
      previousCompletionPct: 65,
    });
    assert.match(out, /can't see why/);
  });

  it("never opens the prose with a number (voice rule: lead with members, not stats)", () => {
    const inputs: InsightInput[] = [
      baseInput,
      { ...baseInput, worstPosition: 1, courseLessonCount: 8 },
      {
        ...baseInput,
        worstPosition: 4,
        courseLessonCount: 6,
        worstCompletionPct: 40,
        previousCompletionPct: 80,
      },
    ];
    for (const input of inputs) {
      const out = buildFallbackInsight(input);
      assert.equal(/^\d/.test(out), false, `prose started with digit: ${out}`);
    }
  });
});

describe("generateCourseDropOffInsight (no API key)", () => {
  it("returns the fallback model name when no API key is provided", async () => {
    const result = await generateCourseDropOffInsight(baseInput, {
      apiKey: null,
    });
    assert.equal(result.model, INSIGHT_FALLBACK_MODEL);
    assert.match(result.body, /\*\*Lesson 3 — New page\*\*/);
  });

  it("uses the fallback when the env var is empty too", async () => {
    const original = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      const result = await generateCourseDropOffInsight(baseInput);
      assert.equal(result.model, INSIGHT_FALLBACK_MODEL);
    } finally {
      if (original !== undefined) process.env.ANTHROPIC_API_KEY = original;
    }
  });
});
