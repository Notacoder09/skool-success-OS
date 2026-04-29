// Pure section builders for the Weekly Optimization Report.
//
// Master plan §"Feature 5" + wisdom doc Feature 5 lock the structure:
//   1. One thing to celebrate            (action: amplify in a post)
//   2. One person to DM today            (action: highest-leverage check-in)
//   3. One lesson to fix                 (action: drop-off pattern)
//   4. One pattern worth knowing         (context: trend / time-of-day)
//   5. One question for the creator      (context: forces reflection)
//
// Wisdom doc cap: max 3 actions per week (overwhelm rule). Sections 4
// and 5 are explicitly framed as context/reflection, not actions, so
// the action count stays at 3 even though the report has 5 sections.
//
// All section builders are pure: data in, prose out. The orchestrator
// gathers the raw data; this file decides what to say with it.

import {
  classifyRetention,
  DAY_90_MILESTONE,
  FIRST_WEEK_WELCOME_DAYS,
  MAX_ACTIONS_PER_REPORT,
  RETENTION_BAD,
  RETENTION_GOOD,
  RETENTION_PLATFORM_AVG,
  type RetentionVerdict,
} from "./thresholds";

export type SectionTone = "action" | "context";

export interface ReportSection {
  /** Display title — verbatim from the wisdom doc. */
  title: string;
  /** Single short paragraph. Plain prose, no markdown. */
  body: string;
  /** Whether this section counts toward the 3-action cap. */
  tone: SectionTone;
}

export interface CelebrateInput {
  /**
   * Member who just crossed day 90 (if any). The strongest celebration
   * shape — directly invokes the wisdom-doc time-is-the-lever insight.
   */
  day90Crossing: { name: string; days: number } | null;
  /**
   * Lesson with a positive completion bump (if any). Used when no
   * day-90 crossing this week.
   */
  topLesson: { title: string; positionInCourse: number } | null;
  /** Number of regulars this week (Skool's "active members" count). */
  regularsThisWeek: number | null;
}

export interface CheckInInput {
  topMember: {
    name: string;
    reason: string;
  } | null;
}

export interface LessonToFixInput {
  worstLesson: {
    title: string;
    positionInCourse: number;
    completionPct: number;
  } | null;
}

export interface PatternInput {
  retentionRate: number | null;
  /** "up" / "down" / "flat" trend for active members vs prior week. */
  regularsTrend: "up" | "down" | "flat" | null;
  /** Best day-of-week label for posting. */
  bestDayOfWeek: string | null;
}

export interface QuestionInput {
  /** Creator's first name, used for direct address. */
  firstName: string | null;
  /** True when retention is below the 80% line. */
  retentionBelowAvg: boolean;
}

export interface FullReportInput {
  celebrate: CelebrateInput;
  checkIn: CheckInInput;
  lessonToFix: LessonToFixInput;
  pattern: PatternInput;
  question: QuestionInput;
  /** True when this is the creator's first week (welcome variant). */
  isFirstWeek: boolean;
  /** Days the creator has been on the platform. */
  daysOnPlatform: number;
}

export function buildCelebrateSection(input: CelebrateInput): ReportSection {
  if (input.day90Crossing) {
    const { name, days } = input.day90Crossing;
    return {
      title: "One thing to celebrate",
      tone: "action",
      body: `${name} just crossed ${days} days as a member this week. Past day 90, churn drops from roughly 20% per month to about 10% — they're starting to stick. Pin a post that thanks the people who've been here a while; it tells everyone else that staying is the norm.`,
    };
  }
  if (input.topLesson) {
    return {
      title: "One thing to celebrate",
      tone: "action",
      body: `Lesson ${input.topLesson.positionInCourse} — ${input.topLesson.title} is moving. Drop a quick post asking who's just finished it and what landed. The community sees activity in the feed and members get a cue to engage.`,
    };
  }
  if (input.regularsThisWeek !== null && input.regularsThisWeek > 0) {
    return {
      title: "One thing to celebrate",
      tone: "action",
      body: `${input.regularsThisWeek} regular${input.regularsThisWeek === 1 ? "" : "s"} showed up this week. Skool's own data says ten true regulars matter more than a thousand strangers — call out one of them by name in the feed.`,
    };
  }
  return {
    title: "One thing to celebrate",
    tone: "action",
    body: `Quiet weeks are real, but they're not failures. Pick one specific thing you saw a member do this week — a comment, a share, a question — and amplify it publicly. That's how the community learns what "good" looks like.`,
  };
}

export function buildCheckInSection(input: CheckInInput): ReportSection {
  if (!input.topMember) {
    return {
      title: "One person to DM today",
      tone: "action",
      body: `Nobody is sliding right now — either everyone's active, or we don't have enough data yet to spot stalls. When in doubt, DM your highest-tenure member with "How's everything going?" The check-in itself is the work; the answer is a bonus.`,
    };
  }
  return {
    title: "One person to DM today",
    tone: "action",
    body: `${input.topMember.name}. ${input.topMember.reason}. Sam's escalation ladder works here: a "sup, how's everything going?" or "saw you've been quieter — anything you need?" beats anything formal. The point is they feel seen.`,
  };
}

export function buildLessonToFixSection(
  input: LessonToFixInput,
): ReportSection {
  const lesson = input.worstLesson;
  if (!lesson) {
    return {
      title: "One lesson to fix",
      tone: "action",
      body: `Nothing stands out as a leak yet. As more members work through the course we'll surface the lesson that's eating them. Until then, walk lesson 1 yourself the way a member with 30 minutes a week would, and ask whether half of it could be cut.`,
    };
  }
  const pct = Math.round(lesson.completionPct);
  return {
    title: "One lesson to fix",
    tone: "action",
    body: `Lesson ${lesson.positionInCourse} — ${lesson.title}. Only ${pct}% of members get past it. AI Jack went from 30% to 5.2% churn by deleting content; before adding more, ask whether half of this lesson could be cut. Open it and read it the way a member with 30 minutes a week would.`,
  };
}

export function buildPatternSection(input: PatternInput): ReportSection {
  const verdict = classifyRetention(input.retentionRate);
  const lines: string[] = [verdict.copy];

  if (input.regularsTrend === "up") {
    lines.push("Regulars are trending up vs last week — the rituals are working.");
  } else if (input.regularsTrend === "down") {
    lines.push("Regulars dipped vs last week — worth a one-line post asking who's around.");
  }

  if (input.bestDayOfWeek) {
    lines.push(
      `Members are most active on ${input.bestDayOfWeek}; line your community calls and posts up with that day before opening a new content track.`,
    );
  }

  return {
    title: "One pattern worth knowing",
    tone: "context",
    body: lines.join(" "),
  };
}

export function buildQuestionSection(input: QuestionInput): ReportSection {
  const namePrefix = input.firstName ? `${input.firstName}, ` : "";
  if (input.retentionBelowAvg) {
    return {
      title: "One question for you",
      tone: "context",
      body: `${namePrefix}what's one thing you'd cut from your community if you had to delete it tomorrow? Less reliably retains people than more. The answer often points to the lesson or post type that's doing the most damage.`,
    };
  }
  return {
    title: "One question for you",
    tone: "context",
    body: `${namePrefix}who is one member you haven't spoken to directly this month? Pick them now, send a one-line DM today, and let us know how it lands next week.`,
  };
}

/**
 * First-week welcome variant. Less data, more orientation. Wisdom doc:
 * "We don't have enough data yet to give you trends. Here's what we'll
 * be tracking, and here's what to do this week to seed it."
 */
export function buildWelcomeSections(opts: {
  daysOnPlatform: number;
  firstName: string | null;
}): ReportSection[] {
  const namePrefix = opts.firstName ? `Hi ${opts.firstName} — ` : "";
  return [
    {
      title: "Welcome",
      tone: "context",
      body: `${namePrefix}you joined ${opts.daysOnPlatform} day${opts.daysOnPlatform === 1 ? "" : "s"} ago and we're still pulling in your data. This first email is short on purpose — there's no week-on-week pattern to read yet. We'll have one next Monday.`,
    },
    {
      title: "What we'll be tracking",
      tone: "context",
      body: `Each Monday we'll surface five things: someone to celebrate, one member worth a DM, the lesson where members are stalling, a pattern from the last week, and a single question to chew on. Three are actions. Two are reflective.`,
    },
    {
      title: "What to do this week",
      tone: "action",
      body: `Pick one member who joined recently and DM them "how's everything going?" Skool's data says month-1 churn is around 20% no matter what — your one-on-one presence is the lever. Don't wait for our first full report.`,
    },
  ];
}

/**
 * Build the full ordered section list. Action count is enforced via
 * MAX_ACTIONS_PER_REPORT — extra actions become "context" tone for
 * display purposes, but their copy is unchanged.
 */
export function buildAllSections(input: FullReportInput): ReportSection[] {
  if (input.isFirstWeek) {
    return buildWelcomeSections({
      daysOnPlatform: input.daysOnPlatform,
      firstName: input.question.firstName,
    });
  }

  const sections: ReportSection[] = [
    buildCelebrateSection(input.celebrate),
    buildCheckInSection(input.checkIn),
    buildLessonToFixSection(input.lessonToFix),
    buildPatternSection(input.pattern),
    buildQuestionSection(input.question),
  ];

  // Defence-in-depth: cap the action count even if a future builder
  // accidentally promotes a context section. We never *drop* sections
  // — we only down-tone them.
  let actionsKept = 0;
  return sections.map((section) => {
    if (section.tone === "action") {
      if (actionsKept >= MAX_ACTIONS_PER_REPORT) {
        return { ...section, tone: "context" };
      }
      actionsKept += 1;
    }
    return section;
  });
}

// Convenience re-exports so callers don't need to import the constants module.
export {
  classifyRetention,
  DAY_90_MILESTONE,
  FIRST_WEEK_WELCOME_DAYS,
  MAX_ACTIONS_PER_REPORT,
  RETENTION_BAD,
  RETENTION_GOOD,
  RETENTION_PLATFORM_AVG,
};
export type { RetentionVerdict };
