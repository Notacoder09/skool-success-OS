import { sql } from "drizzle-orm";

import { db } from "@/db";
import { communityMetricsDaily } from "@/db/schema/communities";
import { SkoolError, type SkoolClient } from "@/lib/skool-api";

import { bucketAdminMetricsByDate } from "./metrics-bucket";

// Day 8 — community-level activity time-series.
//
// We pull /admin-metrics?range=30d&amt=monthly which Skool returns as
// three parallel arrays (total_members[~30], active_members[~30],
// daily_activities[~30]). Each entry has { time: ISO datetime, value }.
// We coerce `time` to a UTC date (YYYY-MM-DD) and upsert one row per
// (community, date), merging the three parallel series on date.
//
// "Best-effort": if any field is missing/malformed we log a warning
// and persist whatever we have. The Pulse view degrades gracefully.
//
// Pure bucketing logic lives in `./metrics-bucket.ts` so unit tests
// don't pull in the Drizzle DB client.

export interface MetricsSyncWarning {
  step: string;
  message: string;
}

export interface MetricsSyncResult {
  apiCalls: number;
  upserted: number;
  warnings: MetricsSyncWarning[];
}

export async function syncCommunityMetrics(
  client: SkoolClient,
  opts: { communityId: string; skoolGroupId: string },
): Promise<MetricsSyncResult> {
  const result: MetricsSyncResult = {
    apiCalls: 0,
    upserted: 0,
    warnings: [],
  };

  let payload;
  try {
    payload = await client.getAdminMetrics(opts.skoolGroupId, {
      range: "30d",
      amt: "monthly",
    });
    result.apiCalls += 1;
  } catch (err) {
    if (err instanceof SkoolError && (err.status === 401 || err.status === 403)) {
      throw err; // bubble auth errors up to orchestrator
    }
    result.warnings.push({
      step: "get_admin_metrics",
      message: err instanceof Error ? err.message : String(err),
    });
    return result;
  }

  const buckets = bucketAdminMetricsByDate(
    payload.total_members,
    payload.active_members,
    payload.daily_activities,
  );

  if (buckets.size === 0) {
    result.warnings.push({
      step: "get_admin_metrics",
      message: "Admin metrics returned no time-series points",
    });
    return result;
  }

  // Upsert each (community, date). We use ON CONFLICT update so a
  // re-sync overwrites the previous reading for the same day (Skool's
  // counts can shift slightly during the day as activity rolls in).
  for (const [dateKey, row] of buckets.entries()) {
    await db
      .insert(communityMetricsDaily)
      .values({
        communityId: opts.communityId,
        metricDate: new Date(`${dateKey}T00:00:00Z`),
        totalMembers: row.totalMembers,
        activeMembers: row.activeMembers,
        dailyActivities: row.dailyActivities,
      })
      .onConflictDoUpdate({
        target: [
          communityMetricsDaily.communityId,
          communityMetricsDaily.metricDate,
        ],
        set: {
          totalMembers: row.totalMembers,
          activeMembers: row.activeMembers,
          dailyActivities: row.dailyActivities,
          updatedAt: sql`now()`,
        },
      });
    result.upserted += 1;
  }

  return result;
}
