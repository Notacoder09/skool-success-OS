// Pure aggregation helpers for /pulse. Operates on the daily
// time-series we persist from Skool's /admin-metrics.
//
// Voice/scope from `creator-wisdom-and-product-decisions.md`,
// Feature 3:
//   - Show activity AS A PATTERN (trending up/flat/down vs my own
//     baseline), not vs. other communities.
//   - Day-of-week activity heatmap → tells creator when to schedule.
//
// All math is pure & dateless beyond the inputs. The page passes
// `asOf` so tests are deterministic.

export interface DailyPoint {
  date: Date;
  totalMembers: number | null;
  activeMembers: number | null;
  dailyActivities: number | null;
}

export type Trend = "up" | "flat" | "down";

export interface TrendDelta {
  trend: Trend;
  /** Absolute delta (latest - prior). */
  delta: number;
  /** Percent delta vs. prior. Null when prior is 0 (avoid divide-by-zero). */
  pctDelta: number | null;
  latest: number;
  prior: number;
}

const FLAT_THRESHOLD_PCT = 5; // ±5% counts as "flat" — wisdom doc says
// patterns matter more than tiny wiggles. Anything inside ±5% is noise.

/**
 * Compares the most recent value against the value from `windowDays`
 * earlier. Used for "Members trend" and "Daily activity trend" tiles.
 */
export function trendOverWindow(
  points: DailyPoint[],
  field: keyof Pick<DailyPoint, "totalMembers" | "activeMembers" | "dailyActivities">,
  windowDays: number,
): TrendDelta | null {
  if (points.length === 0) return null;
  const sorted = [...points].sort(
    (a, b) => a.date.getTime() - b.date.getTime(),
  );
  const latestPoint = sorted[sorted.length - 1];
  if (!latestPoint) return null;
  const latest = latestPoint[field];
  if (latest === null) return null;

  // Find the closest point at or before (latest - windowDays).
  const target = new Date(latestPoint.date.getTime() - windowDays * 86_400_000);
  let prior: number | null = null;
  for (let i = sorted.length - 1; i >= 0; i -= 1) {
    const p = sorted[i];
    if (!p) continue;
    if (p.date.getTime() <= target.getTime() && p[field] !== null) {
      prior = p[field];
      break;
    }
  }
  if (prior === null) return null;

  const delta = latest - prior;
  const pctDelta = prior === 0 ? null : (delta / prior) * 100;
  let trend: Trend = "flat";
  if (pctDelta === null) {
    trend = delta > 0 ? "up" : delta < 0 ? "down" : "flat";
  } else if (pctDelta > FLAT_THRESHOLD_PCT) {
    trend = "up";
  } else if (pctDelta < -FLAT_THRESHOLD_PCT) {
    trend = "down";
  }
  return { trend, delta, pctDelta, latest, prior };
}

/**
 * Sums `dailyActivities` per day-of-week (0 = Sunday). Only counts
 * non-null points. Returned array is always length 7.
 */
export function activityByDayOfWeek(points: DailyPoint[]): number[] {
  const sums = [0, 0, 0, 0, 0, 0, 0];
  for (const p of points) {
    if (p.dailyActivities === null) continue;
    const dow = p.date.getUTCDay();
    sums[dow] = (sums[dow] ?? 0) + p.dailyActivities;
  }
  return sums;
}

/**
 * Returns the latest non-null reading for a field. Useful for the
 * "Regulars this week" and "Members" headline numbers.
 */
export function latestValue(
  points: DailyPoint[],
  field: keyof Pick<DailyPoint, "totalMembers" | "activeMembers" | "dailyActivities">,
): number | null {
  const sorted = [...points].sort(
    (a, b) => b.date.getTime() - a.date.getTime(),
  );
  for (const p of sorted) {
    const v = p[field];
    if (v !== null) return v;
  }
  return null;
}
