"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";

import { db } from "@/db";
import { courses, lessons } from "@/db/schema/communities";
import {
  dispatchFlashcardSends,
  resolveLessonContent,
} from "@/lib/flashcards/orchestrator";
import {
  getCurrentCreator,
  getPrimaryCommunity,
} from "@/lib/server/creator";

// Server actions for /flashcards. All call shapes are minimal and
// idempotent — repeating any of these is safe.

export type RegenerateAllResult =
  | { ok: true; processed: number; generated: number; skipped: number; deferred: number }
  | { ok: false; error: string };

/**
 * Walk every lesson in the creator's primary community, run the
 * source resolver, persist content + cards (when applicable). Used
 * by the "Regenerate all" button on the page header.
 */
export async function regenerateAllSources(): Promise<RegenerateAllResult> {
  const creator = await getCurrentCreator();
  if (!creator) return { ok: false, error: "not_authenticated" };

  const community = await getPrimaryCommunity(creator.creatorId);
  if (!community) return { ok: false, error: "no_community" };

  const lessonRows = await db
    .select({ id: lessons.id })
    .from(lessons)
    .innerJoin(courses, eq(courses.id, lessons.courseId))
    .where(eq(courses.communityId, community.id));

  let generated = 0;
  let skipped = 0;
  let deferred = 0;

  for (const l of lessonRows) {
    try {
      const result = await resolveLessonContent({
        lessonId: l.id,
        creatorId: creator.creatorId,
      });
      if (result.status === "generated" || result.status === "regenerated") {
        generated += 1;
      } else if (result.status === "skipped") {
        skipped += 1;
      } else if (result.status === "deferred") {
        deferred += 1;
      }
    } catch (err) {
      // We tolerate per-lesson failures here — the page will reflect
      // whatever state we managed to reach.
      // eslint-disable-next-line no-console
      console.warn("[flashcards.regenerateAllSources] lesson failed", l.id, err);
    }
  }

  revalidatePath("/flashcards");
  return {
    ok: true,
    processed: lessonRows.length,
    generated,
    skipped,
    deferred,
  };
}

export type RegenerateLessonResult =
  | { ok: true; status: string; sourceLabel: string; cardCount: number }
  | { ok: false; error: string };

export async function regenerateLessonAction(
  lessonId: string,
): Promise<RegenerateLessonResult> {
  const creator = await getCurrentCreator();
  if (!creator) return { ok: false, error: "not_authenticated" };

  const community = await getPrimaryCommunity(creator.creatorId);
  if (!community) return { ok: false, error: "no_community" };

  // Authorisation: confirm this lesson belongs to the creator's community.
  const [scoped] = await db
    .select({ id: lessons.id })
    .from(lessons)
    .innerJoin(courses, eq(courses.id, lessons.courseId))
    .where(eq(lessons.id, lessonId));
  if (!scoped) return { ok: false, error: "lesson_not_found" };

  try {
    const result = await resolveLessonContent({
      lessonId,
      creatorId: creator.creatorId,
    });
    revalidatePath("/flashcards");
    return {
      ok: true,
      status: result.status,
      sourceLabel: result.label,
      cardCount: result.cards?.length ?? 0,
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export type DispatchNowResult =
  | {
      ok: true;
      considered: number;
      sent: number;
      alreadySent: number;
      skippedNoCards: number;
      skippedNoEmail: number;
      failed: number;
    }
  | { ok: false; error: string };

/**
 * Manual dispatch button. Same code path as the cron — the cron runs
 * hourly, this just lets the creator force a sweep right now.
 */
export async function dispatchSendsNow(): Promise<DispatchNowResult> {
  const creator = await getCurrentCreator();
  if (!creator) return { ok: false, error: "not_authenticated" };

  try {
    const summary = await dispatchFlashcardSends({
      creatorId: creator.creatorId,
    });
    revalidatePath("/flashcards");
    return {
      ok: true,
      considered: summary.considered,
      sent: summary.sent,
      alreadySent: summary.alreadySent,
      skippedNoCards: summary.skippedNoCards,
      skippedNoEmail: summary.skippedNoEmail,
      failed: summary.failed,
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
