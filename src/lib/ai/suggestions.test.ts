import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildSuggestedActions, type SuggestionInput } from "./suggestions";

const baseInput = (overrides: Partial<SuggestionInput> = {}): SuggestionInput => ({
  lessonPosition: 3,
  courseLessonCount: 6,
  lessonCompletionPct: 50,
  previousCompletionPct: 80,
  memberCount: 25,
  ...overrides,
});

describe("buildSuggestedActions", () => {
  it("returns empty array when there is no completion data", () => {
    const actions = buildSuggestedActions(
      baseInput({ lessonCompletionPct: null }),
    );
    assert.deepEqual(actions, []);
  });

  it("returns at most 3 actions (overwhelm rule)", () => {
    // Inputs that trigger many rules at once.
    const actions = buildSuggestedActions(
      baseInput({
        lessonPosition: 2,
        courseLessonCount: 6,
        lessonCompletionPct: 30,
        previousCompletionPct: 90,
        memberCount: 10,
      }),
    );
    assert.ok(actions.length <= 3);
  });

  it("ranks the cliff-drop rewatch action first when there's a big delta", () => {
    const actions = buildSuggestedActions(
      baseInput({
        lessonCompletionPct: 33,
        previousCompletionPct: 80,
      }),
    );
    assert.equal(actions[0]?.id, "rewatch-previous");
  });

  it("falls back to split-or-trim when there is no previous-lesson data", () => {
    const actions = buildSuggestedActions(
      baseInput({
        lessonPosition: 1,
        lessonCompletionPct: 40,
        previousCompletionPct: null,
      }),
    );
    assert.equal(actions[0]?.id, "split-or-trim");
  });

  it("recommends 'hold the data' first for tiny samples", () => {
    const actions = buildSuggestedActions(
      baseInput({
        lessonCompletionPct: 50,
        previousCompletionPct: 100,
        memberCount: 3,
      }),
    );
    // Even when a cliff exists, with <5 members the honesty move wins.
    assert.equal(actions[0]?.id, "hold-the-data");
  });

  it("includes the early-course rule when lesson is in module 1-2", () => {
    const actions = buildSuggestedActions(
      baseInput({
        lessonPosition: 2,
        lessonCompletionPct: 60,
        previousCompletionPct: 80,
      }),
    );
    const ids = actions.map((a) => a.id);
    assert.ok(
      ids.includes("shorten-early-curriculum"),
      `expected shorten-early-curriculum in ${JSON.stringify(ids)}`,
    );
  });

  it("uses the post-quick-win action for healthier lessons (>=60%)", () => {
    const actions = buildSuggestedActions(
      baseInput({
        lessonPosition: 4,
        courseLessonCount: 6,
        lessonCompletionPct: 70,
        previousCompletionPct: 80,
      }),
    );
    const ids = actions.map((a) => a.id);
    assert.ok(ids.includes("post-quick-win"));
    assert.ok(!ids.includes("split-or-trim"));
  });

  it("never recommends shorten-early-curriculum for late-course lessons", () => {
    const actions = buildSuggestedActions(
      baseInput({
        lessonPosition: 5,
        courseLessonCount: 6,
        lessonCompletionPct: 30,
        previousCompletionPct: 70,
      }),
    );
    const ids = actions.map((a) => a.id);
    assert.ok(!ids.includes("shorten-early-curriculum"));
  });

  it("each action has a non-empty title, body, and reason", () => {
    const actions = buildSuggestedActions(baseInput());
    for (const a of actions) {
      assert.ok(a.title.length > 0);
      assert.ok(a.body.length > 0);
      assert.ok(a.reason.length > 0);
    }
  });

  it("never returns duplicate action ids", () => {
    const actions = buildSuggestedActions(baseInput());
    const ids = actions.map((a) => a.id);
    assert.equal(new Set(ids).size, ids.length);
  });
});
