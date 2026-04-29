"use server";

import { revalidatePath } from "next/cache";
import { and, asc, desc, eq } from "drizzle-orm";

import { db } from "@/db";
import { courses, lessons } from "@/db/schema/communities";
import { lessonInsights } from "@/db/schema/reports";
import { syncRuns } from "@/db/schema/sync";
import { regenerateLessonInsight, INSIGHT_FALLBACK_MODEL } from "@/lib/ai";
import { getCurrentCreator, getPrimaryCommunity } from "@/lib/server/creator";

// Day 6 — manual "Regenerate insight" trigger on the lesson zoom page.
// Throttled so a creator can't burn Anthropic credits by spamming the
// button. Throttle window is shorter than INSIGHT_TTL_MS because the
// caller has a real reason to override it (data feels stale).

const REGENERATE_THROTTLE_MS = 60_000;

export type RegenerateResult =
  | { ok: true; message: string; usedFallback: boolean }
  | {
      ok: false;
      reason: "no_creator" | "no_community" | "not_found" | "throttled" | "no_data";
      message: string;
    };

export async function regenerateInsightForLesson(
  lessonId: string,
): Promise<RegenerateResult> {
  const creator = await getCurrentCreator();
  if (!creator) {
    return { ok: false, reason: "no_creator", message: "Sign in again." };
  }

  const community = await getPrimaryCommunity(creator.creatorId);
  if (!community) {
    return {
      ok: false,
      reason: "no_community",
      message: "Connect Skool in Settings first.",
    };
  }

  // Resolve the lesson + verify it belongs to this creator's community.
  // We re-join through courses to enforce ownership at the query level
  // rather than trusting the URL.
  const [lessonRow] = await db
    .select({
      id: lessons.id,
      title: lessons.title,
      positionInCourse: lessons.positionInCourse,
      completionPct: lessons.completionPct,
      courseId: lessons.courseId,
      courseTitle: courses.title,
      communityId: courses.communityId,
    })
    .from(lessons)
    .innerJoin(courses, eq(courses.id, lessons.courseId))
    .where(and(eq(lessons.id, lessonId), eq(courses.communityId, community.id)));

  if (!lessonRow) {
    return {
      ok: false,
      reason: "not_found",
      message: "Lesson not found in your community.",
    };
  }

  if (lessonRow.completionPct === null) {
    return {
      ok: false,
      reason: "no_data",
      message:
        "We don't have completion data for this lesson yet. Refresh the Drop-Off Map first.",
    };
  }

  // Throttle on the existing insight row's generatedAt.
  const [existing] = await db
    .select()
    .from(lessonInsights)
    .where(eq(lessonInsights.lessonId, lessonId));
  if (existing) {
    const sinceMs = Date.now() - existing.generatedAt.getTime();
    if (sinceMs < REGENERATE_THROTTLE_MS) {
      const wait = Math.ceil((REGENERATE_THROTTLE_MS - sinceMs) / 1000);
      return {
        ok: false,
        reason: "throttled",
        message: `Just regenerated — try again in ${wait}s.`,
      };
    }
  }

  // Re-pull neighbours for the insight prompt.
  const courseLessons = await db
    .select({
      id: lessons.id,
      title: lessons.title,
      position: lessons.positionInCourse,
      completionPct: lessons.completionPct,
    })
    .from(lessons)
    .where(eq(lessons.courseId, lessonRow.courseId))
    .orderBy(asc(lessons.positionInCourse));

  const idx = courseLessons.findIndex((l) => l.id === lessonRow.id);
  const prev = idx > 0 ? courseLessons[idx - 1] : null;
  const next = idx >= 0 && idx < courseLessons.length - 1 ? courseLessons[idx + 1] : null;

  // Member count denominator for prose (members with progression rows).
  // We count "members with at least one completion in this community"
  // via the latest sync run's snapshot — same definition the page uses.
  const [latestRun] = await db
    .select({ membersUpserted: syncRuns.membersUpserted })
    .from(syncRuns)
    .where(eq(syncRuns.communityId, community.id))
    .orderBy(desc(syncRuns.startedAt))
    .limit(1);

  const memberCount = latestRun?.membersUpserted ?? 0;

  const result = await regenerateLessonInsight(lessonRow.id, {
    courseTitle: lessonRow.courseTitle,
    courseLessonCount: courseLessons.length,
    memberCount,
    worstPosition: lessonRow.positionInCourse,
    worstTitle: lessonRow.title,
    worstCompletionPct: Number(lessonRow.completionPct),
    previousPosition: prev?.position ?? null,
    previousTitle: prev?.title ?? null,
    previousCompletionPct:
      prev?.completionPct !== undefined && prev?.completionPct !== null
        ? Number(prev.completionPct)
        : null,
    nextPosition: next?.position ?? null,
    nextTitle: next?.title ?? null,
    nextCompletionPct:
      next?.completionPct !== undefined && next?.completionPct !== null
        ? Number(next.completionPct)
        : null,
  });

  revalidatePath(`/drop-off/lessons/${lessonId}`);
  revalidatePath("/drop-off");

  return {
    ok: true,
    usedFallback: result.model === INSIGHT_FALLBACK_MODEL,
    message: "Insight regenerated.",
  };
}
