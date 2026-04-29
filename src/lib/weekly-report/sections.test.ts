import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildAllSections,
  buildCelebrateSection,
  buildCheckInSection,
  buildLessonToFixSection,
  buildPatternSection,
  buildQuestionSection,
  buildWelcomeSections,
  type FullReportInput,
} from "./sections";
import { MAX_ACTIONS_PER_REPORT } from "./thresholds";

const baseInput: FullReportInput = {
  celebrate: {
    day90Crossing: null,
    topLesson: null,
    regularsThisWeek: null,
  },
  checkIn: { topMember: null },
  lessonToFix: { worstLesson: null },
  pattern: {
    retentionRate: null,
    regularsTrend: null,
    bestDayOfWeek: null,
  },
  question: { firstName: null, retentionBelowAvg: false },
  isFirstWeek: false,
  daysOnPlatform: 30,
};

describe("buildCelebrateSection", () => {
  it("prefers a day-90 crossing over any other shape", () => {
    const out = buildCelebrateSection({
      day90Crossing: { name: "Sarah", days: 92 },
      topLesson: { title: "Funnel Maths", positionInCourse: 4 },
      regularsThisWeek: 12,
    });
    assert.match(out.body, /Sarah/);
    assert.match(out.body, /92 days/);
    assert.match(out.body, /past day 90/i);
    assert.equal(out.tone, "action");
  });

  it("falls back to a top lesson when no day-90 crossing", () => {
    const out = buildCelebrateSection({
      day90Crossing: null,
      topLesson: { title: "Funnel Maths", positionInCourse: 4 },
      regularsThisWeek: 0,
    });
    assert.match(out.body, /Lesson 4/);
    assert.match(out.body, /Funnel Maths/);
  });

  it("falls back to a regulars callout when nothing else is available", () => {
    const out = buildCelebrateSection({
      day90Crossing: null,
      topLesson: null,
      regularsThisWeek: 8,
    });
    assert.match(out.body, /8 regulars?/);
  });

  it("provides honest copy for fully empty weeks", () => {
    const out = buildCelebrateSection({
      day90Crossing: null,
      topLesson: null,
      regularsThisWeek: 0,
    });
    assert.match(out.body, /Quiet weeks are real/);
  });
});

describe("buildCheckInSection", () => {
  it("names the member and reason verbatim when present", () => {
    const out = buildCheckInSection({
      topMember: { name: "Marcus", reason: "no posts in 14 days" },
    });
    assert.match(out.body, /Marcus/);
    assert.match(out.body, /no posts in 14 days/);
  });

  it("provides a default DM nudge when no flags exist", () => {
    const out = buildCheckInSection({ topMember: null });
    assert.match(out.body, /How's everything going/);
    assert.equal(out.tone, "action");
  });
});

describe("buildLessonToFixSection", () => {
  it("uses the lesson position + title + completion %", () => {
    const out = buildLessonToFixSection({
      worstLesson: {
        title: "Module 1 Lesson 3",
        positionInCourse: 3,
        completionPct: 42,
      },
    });
    assert.match(out.body, /Lesson 3/);
    assert.match(out.body, /42%/);
    assert.match(out.body, /AI Jack/);
  });

  it("returns an honest 'nothing yet' message when no leak", () => {
    const out = buildLessonToFixSection({ worstLesson: null });
    assert.match(out.body, /Nothing stands out/i);
  });
});

describe("buildPatternSection", () => {
  it("flags retention below 80% explicitly", () => {
    const out = buildPatternSection({
      retentionRate: 0.72,
      regularsTrend: null,
      bestDayOfWeek: null,
    });
    assert.match(out.body, /80%/);
    assert.equal(out.tone, "context");
  });

  it("celebrates retention >= 90% and includes regulars trend", () => {
    const out = buildPatternSection({
      retentionRate: 0.92,
      regularsTrend: "up",
      bestDayOfWeek: "Tuesday",
    });
    assert.match(out.body, /good/i);
    assert.match(out.body, /Tuesday/);
    assert.match(out.body, /trending up/i);
  });
});

describe("buildQuestionSection", () => {
  it("uses the cut-content question when retention is below average", () => {
    const out = buildQuestionSection({
      firstName: "Alex",
      retentionBelowAvg: true,
    });
    assert.match(out.body, /^Alex,/);
    assert.match(out.body, /cut/i);
  });

  it("uses the under-served-member question otherwise", () => {
    const out = buildQuestionSection({
      firstName: null,
      retentionBelowAvg: false,
    });
    assert.match(out.body, /haven't spoken to/i);
  });
});

describe("buildAllSections", () => {
  it("returns 5 sections for the regular variant", () => {
    const sections = buildAllSections(baseInput);
    assert.equal(sections.length, 5);
    const titles = sections.map((s) => s.title);
    assert.deepEqual(titles, [
      "One thing to celebrate",
      "One person to DM today",
      "One lesson to fix",
      "One pattern worth knowing",
      "One question for you",
    ]);
  });

  it("emits at most MAX_ACTIONS_PER_REPORT 'action' sections", () => {
    const sections = buildAllSections(baseInput);
    const actionCount = sections.filter((s) => s.tone === "action").length;
    assert.ok(actionCount <= MAX_ACTIONS_PER_REPORT);
  });

  it("uses the welcome variant when isFirstWeek is true", () => {
    const sections = buildAllSections({ ...baseInput, isFirstWeek: true });
    const titles = sections.map((s) => s.title);
    assert.ok(titles.some((t) => t === "Welcome"));
    assert.ok(titles.some((t) => t === "What we'll be tracking"));
    assert.ok(titles.some((t) => t === "What to do this week"));
  });
});

describe("buildWelcomeSections", () => {
  it("personalises with the first name when provided", () => {
    const out = buildWelcomeSections({
      daysOnPlatform: 3,
      firstName: "Mira",
    });
    assert.match(out[0]!.body, /Mira/);
  });

  it("explains 5 sections, 3 actions, 2 reflective", () => {
    const [, second] = buildWelcomeSections({
      daysOnPlatform: 1,
      firstName: null,
    });
    assert.match(second!.body, /five things/i);
    assert.match(second!.body, /Three are actions/i);
  });
});
