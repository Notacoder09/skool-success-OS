import { and, countDistinct, eq, inArray, isNotNull } from "drizzle-orm";

import { db } from "@/db";
import {
  courses,
  lessons,
  memberProgress,
  members,
} from "@/db/schema/communities";
import {
  SkoolAuthError,
  SkoolError,
  SkoolNotFoundError,
  type SkoolClient,
} from "@/lib/skool-api";

import {
  computeLessonCompletionPct,
  type CompletionCounts,
} from "./aggregation";
import { harvestSkoolUuids } from "./harvest";
import {
  flattenProgressionUnits,
  type ProgressionSyncResult,
  type ProgressionWarning,
} from "./progression";

// Day 5 sync steps (DB-touching). Pure helpers live in:
//   - harvest.ts           UUID extraction
//   - progression.ts       per-member metadata interpretation
//   - aggregation.ts       per-lesson % math
//
// All three steps are best-effort: a failure produces a warning and the
// run is marked 'partial' rather than 'failed', so a single bad member
// doesn't tank the whole sync.

// ---------------------------------------------------------------------------
// Step 1 — Member discovery (harvest from analytics + ensure creator row)
// ---------------------------------------------------------------------------

export interface DiscoveryWarning {
  step: "analytics_overview" | "analytics_growth";
  message: string;
}

export interface DiscoveryResult {
  apiCalls: number;
  upserted: number;
  warnings: DiscoveryWarning[];
}

// Try to harvest member IDs from the two analytics endpoints we know
// work. Anything UUID-shaped that isn't already a course or lesson
// gets inserted as a candidate member with source='harvest'. The
// progression step (next) is the actual confirmation: false positives
// will 404 and stay dormant.
export async function discoverMembersFromAnalytics(
  client: SkoolClient,
  opts: { communityId: string; skoolGroupId: string },
): Promise<DiscoveryResult> {
  const result: DiscoveryResult = {
    apiCalls: 0,
    upserted: 0,
    warnings: [],
  };

  const exclude = await buildKnownIdSet(opts);

  // analytics-overview-v2 first; if it returns a payload we can poke at,
  // collect UUID candidates. We catch broad errors here because the
  // analytics endpoints are async/poll-based and can time out.
  try {
    const overview = await client.getAnalyticsOverview(opts.skoolGroupId, {
      maxWaitMs: 12_000,
      intervalMs: 800,
    });
    result.apiCalls += 1;
    const found = harvestSkoolUuids(overview, { exclude });
    if (found.length > 0) {
      result.upserted += await upsertHarvestedMemberIds(
        opts.communityId,
        found,
      );
    }
  } catch (err) {
    if (err instanceof SkoolAuthError) throw err;
    result.warnings.push({
      step: "analytics_overview",
      message: errorMessage(err),
    });
  }

  // Same trick on growth analytics — different shape, sometimes lists
  // top-active members which is exactly what we want.
  try {
    const growth = await client.getAnalyticsGrowthOverview(
      opts.skoolGroupId,
      { maxWaitMs: 12_000, intervalMs: 800 },
    );
    result.apiCalls += 1;
    const found = harvestSkoolUuids(growth, {
      exclude: await buildKnownIdSet(opts), // refresh in case step above added rows
    });
    if (found.length > 0) {
      result.upserted += await upsertHarvestedMemberIds(
        opts.communityId,
        found,
      );
    }
  } catch (err) {
    if (err instanceof SkoolAuthError) throw err;
    result.warnings.push({
      step: "analytics_growth",
      message: errorMessage(err),
    });
  }

  return result;
}

// Build the "do not harvest" set: the group ID itself, the creator's
// user_id (visible on any course unit we already stored), all course
// IDs, all lesson IDs, and all members we already know about. This is
// the cheap-and-correct way to keep harvest results member-shaped.
async function buildKnownIdSet(opts: {
  communityId: string;
  skoolGroupId: string;
}): Promise<Set<string>> {
  const ids = new Set<string>();
  ids.add(opts.skoolGroupId);

  const courseRows = await db
    .select({
      skoolCourseId: courses.skoolCourseId,
    })
    .from(courses)
    .where(eq(courses.communityId, opts.communityId));
  for (const r of courseRows) ids.add(r.skoolCourseId);

  if (courseRows.length > 0) {
    const courseIds = courseRows.map((r) => r.skoolCourseId);
    const lessonRows = await db
      .select({ skoolLessonId: lessons.skoolLessonId })
      .from(lessons)
      .innerJoin(courses, eq(courses.id, lessons.courseId))
      .where(
        and(
          eq(courses.communityId, opts.communityId),
          inArray(courses.skoolCourseId, courseIds),
        ),
      );
    for (const r of lessonRows) ids.add(r.skoolLessonId);
  }

  const memberRows = await db
    .select({ skoolMemberId: members.skoolMemberId })
    .from(members)
    .where(
      and(
        eq(members.communityId, opts.communityId),
        isNotNull(members.skoolMemberId),
      ),
    );
  for (const r of memberRows) {
    if (r.skoolMemberId) ids.add(r.skoolMemberId);
  }

  return ids;
}

async function upsertHarvestedMemberIds(
  communityId: string,
  skoolMemberIds: string[],
): Promise<number> {
  if (skoolMemberIds.length === 0) return 0;
  const now = new Date();
  let inserted = 0;
  for (const skoolMemberId of skoolMemberIds) {
    const rows = await db
      .insert(members)
      .values({
        communityId,
        skoolMemberId,
        source: "harvest",
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing({
        target: [members.communityId, members.skoolMemberId],
      })
      .returning({ id: members.id });
    if (rows[0]) inserted += 1;
  }
  return inserted;
}

// ---------------------------------------------------------------------------
// Step 2 — Per-member progression sync
// ---------------------------------------------------------------------------

export async function syncProgressionForKnownMembers(
  client: SkoolClient,
  opts: { communityId: string; skoolGroupId: string },
): Promise<ProgressionSyncResult> {
  const result: ProgressionSyncResult = {
    apiCalls: 0,
    upserted: 0,
    membersAttempted: 0,
    membersSucceeded: 0,
    warnings: [],
  };

  const memberRows = await db
    .select({ id: members.id, skoolMemberId: members.skoolMemberId })
    .from(members)
    .where(eq(members.communityId, opts.communityId));
  const knownMembers = memberRows.filter(
    (m): m is { id: string; skoolMemberId: string } =>
      typeof m.skoolMemberId === "string" && m.skoolMemberId.length > 0,
  );
  if (knownMembers.length === 0) return result;

  const lessonRows = await db
    .select({
      id: lessons.id,
      skoolLessonId: lessons.skoolLessonId,
    })
    .from(lessons)
    .innerJoin(courses, eq(courses.id, lessons.courseId))
    .where(eq(courses.communityId, opts.communityId));
  const lessonByExternalId = new Map(
    lessonRows.map((l) => [l.skoolLessonId, l.id]),
  );
  if (lessonByExternalId.size === 0) return result;

  for (const m of knownMembers) {
    result.membersAttempted += 1;
    try {
      const progression = await client.getMemberProgression(
        opts.skoolGroupId,
        m.skoolMemberId,
      );
      result.apiCalls += 1;

      const flat = flattenProgressionUnits(progression);
      const now = new Date();
      let memberHadActivity = false;
      let latestActivityAt: Date | null = null;

      for (const row of flat) {
        const lessonId = lessonByExternalId.get(row.skoolUnitId);
        if (!lessonId) continue;

        await db
          .insert(memberProgress)
          .values({
            memberId: m.id,
            lessonId,
            completionPct:
              row.completionPct !== null
                ? row.completionPct.toFixed(2)
                : null,
            completedAt: row.completedAt,
            lastActivityAt: row.lastActivityAt,
            updatedAt: now,
          })
          .onConflictDoUpdate({
            target: [memberProgress.memberId, memberProgress.lessonId],
            set: {
              completionPct:
                row.completionPct !== null
                  ? row.completionPct.toFixed(2)
                  : null,
              completedAt: row.completedAt,
              lastActivityAt: row.lastActivityAt,
              updatedAt: now,
            },
          });
        result.upserted += 1;

        const stamp = row.completedAt ?? row.lastActivityAt;
        if (stamp) {
          memberHadActivity = true;
          if (!latestActivityAt || stamp.getTime() > latestActivityAt.getTime()) {
            latestActivityAt = stamp;
          }
        }
      }

      if (memberHadActivity && latestActivityAt) {
        await db
          .update(members)
          .set({ lastActiveAt: latestActivityAt, updatedAt: now })
          .where(eq(members.id, m.id));
      }

      result.membersSucceeded += 1;
    } catch (err) {
      if (err instanceof SkoolAuthError) throw err;
      const message =
        err instanceof SkoolNotFoundError
          ? "Member not found in Skool (may have left the group)"
          : err instanceof SkoolError
            ? err.message
            : err instanceof Error
              ? err.message
              : String(err);
      const warning: ProgressionWarning = {
        step: "get_member_progression",
        message,
        detail: { memberId: m.id, skoolMemberId: m.skoolMemberId },
      };
      result.warnings.push(warning);
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Step 3 — Recompute per-lesson completion %
// ---------------------------------------------------------------------------

export interface AggregationResult {
  lessonsRecomputed: number;
  /** True if no members were tracked yet (so all lessons stay null). */
  noMembersTracked: boolean;
}

// For each lesson in the community, recompute the completion %.
// Denominator: total members for this community (CSV + harvested + API).
// Numerator:   member_progress rows where completed_at IS NOT NULL.
//
// Day 5 keeps this dead simple — small communities only, and it runs
// once per sync. If we ever need per-course enrollment we'll switch to
// a CTE; for now this readable pattern is fine for Xavier-scale data
// (4 lessons × 3 members = 12 rows).
export async function recomputeLessonCompletion(
  communityId: string,
): Promise<AggregationResult> {
  const memberCount = await db
    .select({ id: members.id })
    .from(members)
    .where(eq(members.communityId, communityId));
  const totalMembers = memberCount.length;

  const lessonRows = await db
    .select({ id: lessons.id })
    .from(lessons)
    .innerJoin(courses, eq(courses.id, lessons.courseId))
    .where(eq(courses.communityId, communityId));

  if (totalMembers === 0 || lessonRows.length === 0) {
    return { lessonsRecomputed: 0, noMembersTracked: totalMembers === 0 };
  }

  const now = new Date();
  let updated = 0;
  for (const lesson of lessonRows) {
    const completedRows = await db
      .select({ id: memberProgress.id })
      .from(memberProgress)
      .where(
        and(
          eq(memberProgress.lessonId, lesson.id),
          isNotNull(memberProgress.completedAt),
        ),
      );
    const counts: CompletionCounts = {
      totalMembers,
      completed: completedRows.length,
    };
    const pct = computeLessonCompletionPct(counts);

    await db
      .update(lessons)
      .set({
        completionPct: pct === null ? null : pct.toFixed(2),
        lastSyncedAt: now,
      })
      .where(eq(lessons.id, lesson.id));
    updated += 1;
  }

  // Per-course rollup so the Drop-Off Map header can show
  // "X enrolled · Y completed" honestly. completedCount = members who
  // finished every tracked lesson in the course.
  await refreshCourseCounts(communityId, totalMembers);

  return { lessonsRecomputed: updated, noMembersTracked: false };
}

async function refreshCourseCounts(
  communityId: string,
  totalMembers: number,
): Promise<void> {
  const courseRows = await db
    .select({ id: courses.id })
    .from(courses)
    .where(eq(courses.communityId, communityId));

  for (const c of courseRows) {
    const lessonIdRows = await db
      .select({ id: lessons.id })
      .from(lessons)
      .where(eq(lessons.courseId, c.id));
    const lessonIds = lessonIdRows.map((r) => r.id);

    let completedCount = 0;
    if (lessonIds.length > 0) {
      // Per member: how many distinct lessons in this course have they
      // completed? Members whose count equals lessonIds.length finished
      // the whole course.
      const perMember = await db
        .select({
          memberId: memberProgress.memberId,
          completedLessons: countDistinct(memberProgress.lessonId).as(
            "completed_lessons",
          ),
        })
        .from(memberProgress)
        .where(
          and(
            inArray(memberProgress.lessonId, lessonIds),
            isNotNull(memberProgress.completedAt),
          ),
        )
        .groupBy(memberProgress.memberId);
      completedCount = perMember.filter(
        (r) => Number(r.completedLessons) === lessonIds.length,
      ).length;
    }

    await db
      .update(courses)
      .set({
        enrolledCount: totalMembers,
        completedCount,
        lastSyncedAt: new Date(),
      })
      .where(eq(courses.id, c.id));
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
