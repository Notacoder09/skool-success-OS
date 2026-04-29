// Wisdom-doc thresholds for the Weekly Optimization Report.
// Source: docs/creator-wisdom-and-product-decisions.md Part 1 §A and
// Feature 5. Centralised so the values appear in tests once, and any
// future tweak surfaces in one diff.

/** Skool platform-wide average monthly retention. Target line. */
export const RETENTION_PLATFORM_AVG = 0.8;
/** "Good" retention per Skool benchmarks. Celebration threshold. */
export const RETENTION_GOOD = 0.9;
/** "Bad" retention per Skool benchmarks. Escalation threshold. */
export const RETENTION_BAD = 0.7;

/** Tenure in days at which churn drops materially per the wisdom doc. */
export const DAY_90_MILESTONE = 90;
/** Tenure beyond which churn drops to ~2% — graduate territory. */
export const MONTH_6_MILESTONE_DAYS = 180;

/** First-week welcome variant cutoff. */
export const FIRST_WEEK_WELCOME_DAYS = 7;

/** Wisdom doc cap: never propose more than 3 actions per week. */
export const MAX_ACTIONS_PER_REPORT = 3;
/** Master-plan five-section structure. Two of those are reflective context. */
export const TOTAL_SECTIONS = 5;

/**
 * Plain-language verdict on a retention rate. Used by the report
 * sections + the email subject prefix.
 */
export type RetentionVerdict =
  | { tone: "good"; copy: string }
  | { tone: "average"; copy: string }
  | { tone: "below"; copy: string }
  | { tone: "bad"; copy: string }
  | { tone: "unknown"; copy: string };

export function classifyRetention(rate: number | null): RetentionVerdict {
  if (rate === null || !Number.isFinite(rate)) {
    return {
      tone: "unknown",
      copy: "We don't have enough months of data to tell you a retention rate yet.",
    };
  }
  if (rate >= RETENTION_GOOD) {
    return {
      tone: "good",
      copy: `Retention is ${formatPct(rate)} — that's in the "good" band on Skool's benchmarks.`,
    };
  }
  if (rate >= RETENTION_PLATFORM_AVG) {
    return {
      tone: "average",
      copy: `Retention is ${formatPct(rate)} — right around the Skool average.`,
    };
  }
  if (rate >= RETENTION_BAD) {
    return {
      tone: "below",
      copy: `Retention is ${formatPct(rate)} — below the Skool average of 80%. Worth a look this week.`,
    };
  }
  return {
    tone: "bad",
    copy: `Retention is ${formatPct(rate)} — Skool flags anything under 70% as a real problem. This is the week to fix it.`,
  };
}

function formatPct(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}
