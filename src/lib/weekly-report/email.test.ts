import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildReportEmail } from "./email";
import type { ReportSection } from "./sections";

const sections: ReportSection[] = [
  {
    title: "One thing to celebrate",
    tone: "action",
    body: "Sarah just crossed day 92 — past day 90 churn drops to ~10%.",
  },
  {
    title: "One person to DM today",
    tone: "action",
    body: "Marcus has been quiet for 14 days. A 'sup' lands better than a checklist.",
  },
  {
    title: "One lesson to fix",
    tone: "action",
    body: "Lesson 3 leaks 58 points off completion.",
  },
  {
    title: "One pattern worth knowing",
    tone: "context",
    body: "Retention is 78% — below the Skool average of 80%.",
  },
  {
    title: "One question for you",
    tone: "context",
    body: "What's one thing you'd cut tomorrow?",
  },
];

describe("buildReportEmail", () => {
  it("builds subject + html + text + markdown for the weekly variant", () => {
    const out = buildReportEmail({
      firstName: "Alex",
      sections,
      weekLabel: "Week of Apr 27, 2026",
      variant: "weekly",
    });
    assert.match(out.subject, /^Your week — Week of Apr 27, 2026$/);
    assert.match(out.html, /Good Monday, Alex/);
    assert.match(out.text, /^WEEK OF APR 27, 2026/);
    assert.match(out.markdown, /^# Week of Apr 27, 2026/);
  });

  it("welcome variant subject leads with 'Welcome'", () => {
    const out = buildReportEmail({
      firstName: "Alex",
      sections,
      weekLabel: "Week of Apr 27, 2026",
      variant: "welcome",
    });
    assert.match(out.subject, /^Welcome to your weekly review/);
  });

  it("text body uses Action 1 / Action 2 / Action 3 / Context labels", () => {
    const out = buildReportEmail({
      firstName: "Alex",
      sections,
      weekLabel: "Apr 27",
      variant: "weekly",
    });
    assert.match(out.text, /\[Action 1\]/);
    assert.match(out.text, /\[Action 2\]/);
    assert.match(out.text, /\[Action 3\]/);
    assert.match(out.text, /\[Context\]/);
  });

  it("escapes HTML-significant characters in user content", () => {
    const out = buildReportEmail({
      firstName: "<Alex>",
      sections: [
        {
          title: 'Thing & "Other"',
          tone: "action",
          body: "<script>alert('x')</script>",
        },
      ],
      weekLabel: "Apr 27",
      variant: "weekly",
    });
    assert.ok(out.html.includes("&lt;Alex&gt;"));
    assert.ok(out.html.includes("Thing &amp; &quot;Other&quot;"));
    assert.ok(out.html.includes("&lt;script&gt;"));
  });

  it("does not include forbidden growth-marketing language", () => {
    const out = buildReportEmail({
      firstName: "Alex",
      sections,
      weekLabel: "Apr 27",
      variant: "weekly",
    });
    assert.doesNotMatch(out.text, /grew \d+%/i);
    assert.doesNotMatch(out.text, /boost engagement/i);
  });

  it("markdown output preserves section ordering and Action labels", () => {
    const out = buildReportEmail({
      firstName: null,
      sections,
      weekLabel: "Apr 27",
      variant: "weekly",
    });
    const idxAction1 = out.markdown.indexOf("Action 1");
    const idxAction3 = out.markdown.indexOf("Action 3");
    const idxContext = out.markdown.indexOf("Context");
    assert.ok(idxAction1 > -1 && idxAction3 > idxAction1);
    assert.ok(idxContext > idxAction3);
  });
});
