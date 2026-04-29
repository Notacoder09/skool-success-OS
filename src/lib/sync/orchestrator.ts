import { and, eq, gte } from "drizzle-orm";

import { db } from "@/db";
import { communities, courses, lessons } from "@/db/schema/communities";
import { syncRuns } from "@/db/schema/sync";
import type { SkoolCookies } from "@/lib/crypto";
import {
  SkoolClient,
  SkoolError,
  type SkoolCourseTree,
  type SkoolUnit,
} from "@/lib/skool-api";

import { flattenTreeForLessons, normaliseLesson } from "./lessons";
import {
  discoverMembersFromAnalytics,
  recomputeLessonCompletion,
  syncProgressionForKnownMembers,
} from "./members";
import { syncCommunityMetrics } from "./metrics";

// One-stop sync for a single community. Reused by:
//   - the Vercel cron at /api/cron/sync (every 6h)
//   - the manual "Refresh now" button on /drop-off
//   - (later) the connect-Skool flow which fires a first sync on success
//
// Day 4: course list + lesson trees via listGroupCourses + getCourseTree.
// Day 5: member discovery (analytics harvest), per-member progression
// sync, and per-lesson completion-% aggregation. Each Day 5 step is
// best-effort — a failure produces a warning and the run is marked
// 'partial' rather than 'failed'.

export type SyncTrigger = "cron" | "manual" | "connect";
export type SyncStatus = "running" | "succeeded" | "partial" | "failed";

export interface SyncWarning {
  step: string;
  message: string;
  detail?: unknown;
}

export interface SyncRunSummary {
  runId: string;
  status: SyncStatus;
  coursesUpserted: number;
  lessonsUpserted: number;
  membersUpserted: number;
  progressUpserted: number;
  apiCalls: number;
  warnings: SyncWarning[];
  errorMessage: string | null;
  durationMs: number;
}

export interface SyncOptions {
  communityId: string;
  skoolGroupId: string;
  cookies: SkoolCookies;
  trigger: SyncTrigger;
  /** Test seam — pass a fake SkoolClient. */
  client?: SkoolClient;
}

// Anything older than this in `running` is treated as crashed —
// the cron reaper marks it failed. New syncs ignore stale running rows.
export const STALE_RUNNING_WINDOW_MS = 5 * 60_000;

export class SyncAlreadyRunningError extends Error {
  constructor(public readonly runId: string) {
    super(`Sync already running for community (run=${runId})`);
    this.name = "SyncAlreadyRunningError";
  }
}

export async function syncCommunity(opts: SyncOptions): Promise<SyncRunSummary> {
  const startedAt = new Date();
  const client =
    opts.client ?? new SkoolClient({ cookies: opts.cookies });

  // Concurrency check: refuse if a still-fresh `running` row exists for
  // this community. Stale running rows (>5min, presumed crashed) are
  // ignored here; the cron reaps them separately.
  const recentRunning = await db
    .select({ id: syncRuns.id })
    .from(syncRuns)
    .where(
      and(
        eq(syncRuns.communityId, opts.communityId),
        eq(syncRuns.status, "running"),
        gte(syncRuns.startedAt, new Date(Date.now() - STALE_RUNNING_WINDOW_MS)),
      ),
    )
    .limit(1);
  if (recentRunning[0]) {
    throw new SyncAlreadyRunningError(recentRunning[0].id);
  }

  const inserted = await db
    .insert(syncRuns)
    .values({
      communityId: opts.communityId,
      trigger: opts.trigger,
      status: "running",
      startedAt,
    })
    .returning({ id: syncRuns.id });
  const runId = inserted[0]?.id;
  if (!runId) {
    throw new Error("Failed to insert sync_runs row");
  }

  const counters = {
    coursesUpserted: 0,
    lessonsUpserted: 0,
    membersUpserted: 0,
    progressUpserted: 0,
    apiCalls: 0,
  };
  const warnings: SyncWarning[] = [];

  try {
    // --- Step A: course + lesson structure --------------------------------
    const courseList = await client.listGroupCourses(opts.skoolGroupId);
    counters.apiCalls += 1;

    for (const skoolCourse of courseList.courses) {
      const courseRowId = await upsertCourse(opts.communityId, skoolCourse);
      counters.coursesUpserted += 1;

      // Course-tree fetch is best-effort — if Skool 404s on a single
      // course we record a warning and keep going, so one bad course
      // doesn't tank the whole sync (status -> 'partial').
      try {
        const tree = await client.getCourseTree(skoolCourse.id);
        counters.apiCalls += 1;
        const added = await upsertLessonsFromTree(courseRowId, tree);
        counters.lessonsUpserted += added;
      } catch (err) {
        warnings.push({
          step: "get_course_tree",
          message: err instanceof Error ? err.message : String(err),
          detail: { skoolCourseId: skoolCourse.id },
        });
      }
    }

    // --- Step B: member discovery (analytics harvest) ---------------------
    // Best-effort. Skool deliberately hides the member list (master plan
    // Part 4), so we scrape UUID-shaped IDs from analytics responses.
    // CSV import in Settings remains the deterministic path.
    try {
      const discovered = await discoverMembersFromAnalytics(client, {
        communityId: opts.communityId,
        skoolGroupId: opts.skoolGroupId,
      });
      counters.apiCalls += discovered.apiCalls;
      counters.membersUpserted += discovered.upserted;
      for (const w of discovered.warnings) {
        warnings.push({
          step: w.step,
          message: w.message,
        });
      }
    } catch (err) {
      // Auth errors bubble up (cookies expired) — caught by outer catch.
      if (err instanceof SkoolError) throw err;
      warnings.push({
        step: "discover_members",
        message: err instanceof Error ? err.message : String(err),
      });
    }

    // --- Step C: per-member progression -----------------------------------
    try {
      const progression = await syncProgressionForKnownMembers(client, {
        communityId: opts.communityId,
        skoolGroupId: opts.skoolGroupId,
      });
      counters.apiCalls += progression.apiCalls;
      counters.progressUpserted += progression.upserted;
      for (const w of progression.warnings) {
        warnings.push({
          step: w.step,
          message: w.message,
          detail: w.detail,
        });
      }
    } catch (err) {
      if (err instanceof SkoolError) throw err;
      warnings.push({
        step: "sync_progression",
        message: err instanceof Error ? err.message : String(err),
      });
    }

    // --- Step D: per-lesson completion % aggregation ----------------------
    // Pure DB read+write, no Skool API calls — runs even if upstream
    // steps had warnings, so the UI shows what we know.
    try {
      await recomputeLessonCompletion(opts.communityId);
    } catch (err) {
      warnings.push({
        step: "aggregate_completion",
        message: err instanceof Error ? err.message : String(err),
      });
    }

    // --- Step E: community-level activity time-series (Pulse) -------------
    // Best-effort. The Pulse view degrades gracefully if this is
    // missing — empty tiles show "Pending first sync" copy.
    try {
      const metrics = await syncCommunityMetrics(client, {
        communityId: opts.communityId,
        skoolGroupId: opts.skoolGroupId,
      });
      counters.apiCalls += metrics.apiCalls;
      for (const w of metrics.warnings) {
        warnings.push({ step: w.step, message: w.message });
      }
    } catch (err) {
      if (err instanceof SkoolError) throw err;
      warnings.push({
        step: "sync_metrics",
        message: err instanceof Error ? err.message : String(err),
      });
    }

    await db
      .update(communities)
      .set({ lastSyncedAt: new Date() })
      .where(eq(communities.id, opts.communityId));

    const finishedAt = new Date();
    const status: SyncStatus = warnings.length > 0 ? "partial" : "succeeded";
    await db
      .update(syncRuns)
      .set({
        status,
        finishedAt,
        durationMs: finishedAt.getTime() - startedAt.getTime(),
        coursesUpserted: counters.coursesUpserted,
        lessonsUpserted: counters.lessonsUpserted,
        membersUpserted: counters.membersUpserted,
        progressUpserted: counters.progressUpserted,
        apiCalls: counters.apiCalls,
        warnings: warnings.length > 0 ? warnings : null,
      })
      .where(eq(syncRuns.id, runId));

    return {
      runId,
      status,
      ...counters,
      warnings,
      errorMessage: null,
      durationMs: finishedAt.getTime() - startedAt.getTime(),
    };
  } catch (err) {
    const finishedAt = new Date();
    const errMsg = err instanceof Error ? err.message : String(err);
    // For SkoolErrors the path tells us which endpoint blew up; for
    // anything else we just say "unknown" so the cron summary stays
    // useful when grouping failures.
    const errStep =
      err instanceof SkoolError ? `skool:${err.path ?? "?"}` : "unknown";
    await db
      .update(syncRuns)
      .set({
        status: "failed",
        finishedAt,
        durationMs: finishedAt.getTime() - startedAt.getTime(),
        coursesUpserted: counters.coursesUpserted,
        lessonsUpserted: counters.lessonsUpserted,
        membersUpserted: counters.membersUpserted,
        progressUpserted: counters.progressUpserted,
        apiCalls: counters.apiCalls,
        errorMessage: errMsg,
        errorStep: errStep,
        warnings: warnings.length > 0 ? warnings : null,
      })
      .where(eq(syncRuns.id, runId));

    return {
      runId,
      status: "failed",
      ...counters,
      warnings,
      errorMessage: errMsg,
      durationMs: finishedAt.getTime() - startedAt.getTime(),
    };
  }
}

// ---------------------------------------------------------------------------
// Helpers (exported for tests; keep small + pure-ish)
// ---------------------------------------------------------------------------

export async function upsertCourse(
  communityId: string,
  unit: SkoolUnit,
): Promise<string> {
  const title =
    (unit.metadata?.title as string | undefined) ?? unit.name ?? "Untitled course";
  const now = new Date();
  const rows = await db
    .insert(courses)
    .values({
      communityId,
      skoolCourseId: unit.id,
      title,
      lastSyncedAt: now,
    })
    .onConflictDoUpdate({
      target: [courses.communityId, courses.skoolCourseId],
      set: {
        title,
        lastSyncedAt: now,
      },
    })
    .returning({ id: courses.id });
  const id = rows[0]?.id;
  if (!id) {
    throw new Error(`upsertCourse returned no row for ${unit.id}`);
  }
  return id;
}

export async function upsertLessonsFromTree(
  courseRowId: string,
  tree: SkoolCourseTree,
): Promise<number> {
  const flat = flattenTreeForLessons(tree);
  for (const { unit, position } of flat) {
    await upsertLesson(courseRowId, unit, position);
  }
  return flat.length;
}

async function upsertLesson(
  courseRowId: string,
  unit: SkoolUnit,
  position: number,
): Promise<void> {
  const norm = normaliseLesson(unit, position);
  const now = new Date();
  await db
    .insert(lessons)
    .values({
      courseId: courseRowId,
      skoolLessonId: norm.skoolLessonId,
      title: norm.title,
      positionInCourse: norm.positionInCourse,
      description: norm.description,
      descriptionWordCount: norm.descriptionWordCount,
      videoUrl: norm.videoUrl,
      thumbnailUrl: norm.thumbnailUrl,
      durationSeconds: norm.durationSeconds,
      skoolUpdatedAt: norm.skoolUpdatedAt,
      lastSyncedAt: now,
    })
    .onConflictDoUpdate({
      target: [lessons.courseId, lessons.skoolLessonId],
      set: {
        title: norm.title,
        positionInCourse: norm.positionInCourse,
        description: norm.description,
        descriptionWordCount: norm.descriptionWordCount,
        videoUrl: norm.videoUrl,
        thumbnailUrl: norm.thumbnailUrl,
        durationSeconds: norm.durationSeconds,
        skoolUpdatedAt: norm.skoolUpdatedAt,
        lastSyncedAt: now,
      },
    });
}
