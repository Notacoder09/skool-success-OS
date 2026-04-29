import type { SkoolTimePoint } from "@/lib/skool-api";

// Pure bucketing helper for /admin-metrics. Lives in its own file
// (separate from `metrics.ts`) so unit tests can import it without
// pulling in the Drizzle DB client. Same split pattern as
// `aggregation.ts` vs the orchestrator.

export interface DailyMetricsBucket {
  totalMembers: number | null;
  activeMembers: number | null;
  dailyActivities: number | null;
}

/**
 * Bucket Skool's three time-series into a Map keyed by ISO date string.
 *
 * Skool returns each series as parallel arrays of
 * `{ time: ISO datetime, value: number }`. We slice the date portion
 * (UTC) to merge series that share a day, and tolerate slight
 * malformations: missing series, malformed timestamps, string-shaped
 * numerics, NaN values.
 */
export function bucketAdminMetricsByDate(
  totalMembers: SkoolTimePoint[] | undefined,
  activeMembers: SkoolTimePoint[] | undefined,
  dailyActivities: SkoolTimePoint[] | undefined,
): Map<string, DailyMetricsBucket> {
  const out = new Map<string, DailyMetricsBucket>();

  const ensure = (key: string): DailyMetricsBucket => {
    const existing = out.get(key);
    if (existing) return existing;
    const row: DailyMetricsBucket = {
      totalMembers: null,
      activeMembers: null,
      dailyActivities: null,
    };
    out.set(key, row);
    return row;
  };

  const apply = (
    points: SkoolTimePoint[] | undefined,
    field: keyof DailyMetricsBucket,
  ) => {
    if (!points) return;
    for (const p of points) {
      const dateKey = toDateKey(p.time);
      if (!dateKey) continue;
      const row = ensure(dateKey);
      const n = typeof p.value === "number" ? p.value : Number(p.value);
      if (Number.isFinite(n)) {
        row[field] = n;
      }
    }
  };

  apply(totalMembers, "totalMembers");
  apply(activeMembers, "activeMembers");
  apply(dailyActivities, "dailyActivities");

  return out;
}

function toDateKey(iso: string): string | null {
  if (!iso) return null;
  const idx = iso.indexOf("T");
  const datePart = idx >= 0 ? iso.slice(0, idx) : iso;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(datePart)) return null;
  return datePart;
}
