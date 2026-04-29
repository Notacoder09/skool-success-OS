import "server-only";

import { eq } from "drizzle-orm";

import { db } from "@/db";
import { lessonInsights } from "@/db/schema/reports";

import {
  INSIGHT_FALLBACK_MODEL,
  generateCourseDropOffInsight,
  type GeneratedInsight,
  type InsightInput,
} from "./insights";

// Cache layer for the lesson_insights table. The page renders straight
// from cache; we only call Anthropic when one of three things is true:
//
//   1. No row exists for the lesson yet
//   2. The cached row is older than INSIGHT_TTL_MS
//   3. The cached row was written by the rule-based fallback AND the
//      Anthropic key is now configured (lets a creator add the key
//      and immediately upgrade the voice without a manual purge)
//
// Forced regeneration is exposed as a separate function so the
// "Regenerate insight" button can bypass the freshness check while
// still respecting throttle in the calling action.

// 24 hours. Drop-off numbers don't move fast enough to need fresher
// insights, and this keeps Anthropic spend down to a few cents per
// active creator per day.
export const INSIGHT_TTL_MS = 24 * 60 * 60 * 1000;

export interface CachedInsight {
  body: string;
  model: string;
  generatedAt: Date;
  fromCache: boolean;
}

export async function getOrGenerateLessonInsight(
  lessonId: string,
  input: InsightInput,
): Promise<CachedInsight> {
  const [existing] = await db
    .select()
    .from(lessonInsights)
    .where(eq(lessonInsights.lessonId, lessonId));

  if (existing && isFresh(existing.generatedAt) && !shouldUpgradeFromFallback(existing.model)) {
    return {
      body: existing.body,
      model: existing.model,
      generatedAt: existing.generatedAt,
      fromCache: true,
    };
  }

  const generated = await generateCourseDropOffInsight(input);
  const saved = await upsertInsight(lessonId, generated);
  return { ...saved, fromCache: false };
}

export async function regenerateLessonInsight(
  lessonId: string,
  input: InsightInput,
): Promise<CachedInsight> {
  const generated = await generateCourseDropOffInsight(input);
  const saved = await upsertInsight(lessonId, generated);
  return { ...saved, fromCache: false };
}

async function upsertInsight(
  lessonId: string,
  generated: GeneratedInsight,
): Promise<{ body: string; model: string; generatedAt: Date }> {
  const now = new Date();
  await db
    .insert(lessonInsights)
    .values({ lessonId, body: generated.body, model: generated.model, generatedAt: now })
    .onConflictDoUpdate({
      target: lessonInsights.lessonId,
      set: { body: generated.body, model: generated.model, generatedAt: now },
    });
  return { body: generated.body, model: generated.model, generatedAt: now };
}

function isFresh(generatedAt: Date): boolean {
  return Date.now() - generatedAt.getTime() < INSIGHT_TTL_MS;
}

// If the row was written by the rule-based fallback but the creator
// has since added their Anthropic key, opportunistically upgrade on
// the next read. Cheap to check (env var lookup), saves the creator
// from having to click "Regenerate".
function shouldUpgradeFromFallback(model: string): boolean {
  if (model !== INSIGHT_FALLBACK_MODEL) return false;
  return Boolean(process.env.ANTHROPIC_API_KEY);
}
