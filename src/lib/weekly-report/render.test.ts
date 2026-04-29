import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildReportEmail } from "./email";
import { parseMarkdownBlocks } from "./render";
import { buildAllSections } from "./sections";

describe("parseMarkdownBlocks", () => {
  it("round-trips the markdown produced by buildReportEmail", () => {
    const sections = buildAllSections({
      celebrate: {
        day90Crossing: { name: "Sarah", days: 95 },
        topLesson: null,
        regularsThisWeek: 12,
      },
      checkIn: {
        topMember: { name: "Marcus", reason: "no posts in 14 days" },
      },
      lessonToFix: {
        worstLesson: {
          title: "Module 1 Lesson 3",
          positionInCourse: 3,
          completionPct: 42,
        },
      },
      pattern: {
        retentionRate: 0.72,
        regularsTrend: "up",
        bestDayOfWeek: "Tuesday",
      },
      question: { firstName: "Alex", retentionBelowAvg: true },
      isFirstWeek: false,
      daysOnPlatform: 120,
    });

    const email = buildReportEmail({
      firstName: "Alex",
      sections,
      weekLabel: "Week of Apr 27, 2026",
      variant: "weekly",
    });

    const blocks = parseMarkdownBlocks(email.markdown);
    const h1s = blocks.filter((b) => b.kind === "h1");
    const h2s = blocks.filter((b) => b.kind === "h2");
    const tags = blocks.filter((b) => b.kind === "tag");
    const paragraphs = blocks.filter((b) => b.kind === "p");

    assert.equal(h1s.length, 1);
    assert.equal(h2s.length, 5);
    assert.equal(tags.length, 5);
    assert.equal(paragraphs.length, 5);
    assert.equal(h1s[0]?.kind === "h1" && h1s[0].text, "Week of Apr 27, 2026");
  });

  it("classifies Action vs Context tags by name", () => {
    const md = `# Week\n\n## A\n*Action 1*\n\nbody\n\n## B\n*Context*\n\nmore`;
    const blocks = parseMarkdownBlocks(md);
    const tags = blocks.filter((b) => b.kind === "tag");
    assert.equal(tags.length, 2);
    assert.equal(tags[0]?.kind === "tag" && tags[0].tone, "action");
    assert.equal(tags[1]?.kind === "tag" && tags[1].tone, "context");
  });

  it("ignores blank lines and trims paragraphs", () => {
    const md = `# Title\n\n\n## Sec\n*Action 1*\n\n  hello   \n  world\n\n`;
    const blocks = parseMarkdownBlocks(md);
    const para = blocks.find((b) => b.kind === "p");
    assert.equal(para?.kind === "p" && para.text, "hello world");
  });
});
