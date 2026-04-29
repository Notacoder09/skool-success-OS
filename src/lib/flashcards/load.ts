import "server-only";

import {
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  sql,
} from "drizzle-orm";

import { db } from "@/db";
import { courses, lessons } from "@/db/schema/communities";
import {
  flashcards,
  flashcardSends,
  lessonContent,
  transcriptionUsage,
} from "@/db/schema/content";
import { creators } from "@/db/schema/creators";

import {
  describeSource,
  type FlashcardSkipReason,
  type FlashcardSource,
} from "./source";

// Server-side loader for the /flashcards page. Returns one row per
// lesson in the creator's primary community plus the headline numbers
// the page card shows up top.

export interface FlashcardLessonRow {
  lessonId: string;
  lessonTitle: string;
  positionInCourse: number;
  courseId: string;
  courseTitle: string;
  source: FlashcardSource | null;
  skipReason: FlashcardSkipReason | null;
  sourceLabel: string;
  sourceTone: "neutral" | "warning" | "muted";
  /** True if a flashcards row exists for this lesson. */
  hasCards: boolean;
  cardCount: number;
  cardsModel: string | null;
  generatedAt: Date | null;
  /** How many sends fired for this lesson, for the table. */
  sentCount: number;
  /** Earliest queued/sent timestamp shown as "first sent". */
  firstSentAt: Date | null;
}

export interface FlashcardOverview {
  rows: FlashcardLessonRow[];
  totals: {
    lessons: number;
    withCards: number;
    skippedThinSignal: number;
    skippedTranscriptionDisabled: number;
    skippedQuotaReached: number;
    sentToday: number;
    sentAllTime: number;
  };
  quota: {
    minutesUsedThisMonth: number;
    quotaMinutes: number;
    /** True when quota === 0 (unlimited / agency tier). */
    unlimited: boolean;
  };
}

export async function loadFlashcardsOverview(opts: {
  creatorId: string;
  communityId: string;
}): Promise<FlashcardOverview> {
  const { communityId, creatorId } = opts;

  const lessonRows = await db
    .select({
      lessonId: lessons.id,
      lessonTitle: lessons.title,
      positionInCourse: lessons.positionInCourse,
      courseId: courses.id,
      courseTitle: courses.title,
    })
    .from(lessons)
    .innerJoin(courses, eq(courses.id, lessons.courseId))
    .where(eq(courses.communityId, communityId))
    .orderBy(asc(courses.title), asc(lessons.positionInCourse));

  const lessonIds = lessonRows.map((l) => l.lessonId);

  // Per-lesson latest content row (source + skip_reason). We pull all
  // content rows for these lessons, sorted newest-first, and keep the
  // first hit per lesson in JS — keeps the query plain Drizzle.
  const contentRows = lessonIds.length
    ? await db
        .select({
          lessonId: lessonContent.lessonId,
          source: lessonContent.source,
          skipReason: lessonContent.skipReason,
          createdAt: lessonContent.createdAt,
        })
        .from(lessonContent)
        .where(inArray(lessonContent.lessonId, lessonIds))
        .orderBy(desc(lessonContent.createdAt))
    : [];

  const contentByLesson = new Map<
    string,
    { source: FlashcardSource; skipReason: FlashcardSkipReason | null }
  >();
  for (const r of contentRows) {
    if (contentByLesson.has(r.lessonId)) continue;
    contentByLesson.set(r.lessonId, {
      source: r.source as FlashcardSource,
      skipReason: r.skipReason as FlashcardSkipReason | null,
    });
  }

  // Cards (one row per lesson; flashcards.lessonId is unique).
  const cardRows = lessonIds.length
    ? await db
        .select({
          lessonId: flashcards.lessonId,
          cards: flashcards.cards,
          model: flashcards.model,
          generatedAt: flashcards.generatedAt,
        })
        .from(flashcards)
        .where(inArray(flashcards.lessonId, lessonIds))
    : [];
  const cardsByLesson = new Map<
    string,
    {
      count: number;
      model: string;
      generatedAt: Date;
    }
  >();
  for (const r of cardRows) {
    const count = Array.isArray(r.cards) ? r.cards.length : 0;
    cardsByLesson.set(r.lessonId, {
      count,
      model: r.model,
      generatedAt: r.generatedAt,
    });
  }

  // Send counts per lesson + first-sent timestamp.
  const sendAgg = lessonIds.length
    ? await db
        .select({
          lessonId: flashcardSends.lessonId,
          count: sql<number>`COUNT(*)::int`,
          firstSentAt: sql<Date | null>`MIN(${flashcardSends.sentAt})`,
        })
        .from(flashcardSends)
        .where(inArray(flashcardSends.lessonId, lessonIds))
        .groupBy(flashcardSends.lessonId)
    : [];
  const sendByLesson = new Map<
    string,
    { count: number; firstSentAt: Date | null }
  >();
  for (const r of sendAgg) {
    sendByLesson.set(r.lessonId, {
      count: r.count,
      firstSentAt: r.firstSentAt,
    });
  }

  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);
  let sentToday = 0;
  let sentAllTime = 0;

  if (lessonIds.length) {
    const [totals] = await db
      .select({
        all: sql<number>`COUNT(*)::int`,
        today: sql<number>`COUNT(*) FILTER (WHERE ${flashcardSends.sentAt} >= ${todayStart})::int`,
      })
      .from(flashcardSends)
      .where(
        and(
          inArray(flashcardSends.lessonId, lessonIds),
          isNotNull(flashcardSends.sentAt),
        ),
      );
    sentAllTime = totals?.all ?? 0;
    sentToday = totals?.today ?? 0;
  }

  // Build per-row view models.
  const rows: FlashcardLessonRow[] = lessonRows.map((l) => {
    const content = contentByLesson.get(l.lessonId);
    const cards = cardsByLesson.get(l.lessonId);
    const sends = sendByLesson.get(l.lessonId);
    const source = content?.source ?? null;
    const skipReason = content?.skipReason ?? null;
    const labelInfo = source
      ? describeSource(source, skipReason)
      : { label: "Pending — first sync needed", tone: "muted" as const };
    return {
      lessonId: l.lessonId,
      lessonTitle: l.lessonTitle,
      positionInCourse: l.positionInCourse,
      courseId: l.courseId,
      courseTitle: l.courseTitle,
      source,
      skipReason,
      sourceLabel: labelInfo.label,
      sourceTone: labelInfo.tone,
      hasCards: Boolean(cards),
      cardCount: cards?.count ?? 0,
      cardsModel: cards?.model ?? null,
      generatedAt: cards?.generatedAt ?? null,
      sentCount: sends?.count ?? 0,
      firstSentAt: sends?.firstSentAt ?? null,
    };
  });

  // Quota.
  const monthStart = new Date(
    Date.UTC(
      new Date().getUTCFullYear(),
      new Date().getUTCMonth(),
      1,
    ),
  );
  const [quotaRow] = await db
    .select({
      total: sql<number>`COALESCE(SUM(${transcriptionUsage.minutesUsed}), 0)::int`,
    })
    .from(transcriptionUsage)
    .where(
      and(
        eq(transcriptionUsage.creatorId, creatorId),
        gte(transcriptionUsage.ranAt, monthStart),
      ),
    );
  const minutesUsedThisMonth = quotaRow?.total ?? 0;

  const [creatorRow] = await db
    .select({
      transcriptionMinutesQuota: creators.transcriptionMinutesQuota,
    })
    .from(creators)
    .where(eq(creators.id, creatorId));
  const quotaMinutes = creatorRow?.transcriptionMinutesQuota ?? 0;

  const totals = {
    lessons: rows.length,
    withCards: rows.filter((r) => r.hasCards).length,
    skippedThinSignal: rows.filter(
      (r) => r.source === "skipped" && r.skipReason === "thin_signal",
    ).length,
    skippedTranscriptionDisabled: rows.filter(
      (r) => r.source === "skipped" && r.skipReason === "transcription_disabled",
    ).length,
    skippedQuotaReached: rows.filter(
      (r) => r.source === "skipped" && r.skipReason === "quota_reached",
    ).length,
    sentToday,
    sentAllTime,
  };

  return {
    rows,
    totals,
    quota: {
      minutesUsedThisMonth,
      quotaMinutes,
      unlimited: quotaMinutes === 0,
    },
  };
}
