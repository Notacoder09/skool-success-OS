import "server-only";

import { createHash } from "node:crypto";

import { and, desc, eq, gte, inArray, isNotNull, lt, sql } from "drizzle-orm";

import { db } from "@/db";
import { courses, lessons, members, memberProgress } from "@/db/schema/communities";
import {
  flashcards,
  flashcardSends,
  lessonContent,
  transcriptionUsage,
  type flashcardSendStatusEnum,
  type skipReasonEnum,
  type transcriptSourceEnum,
} from "@/db/schema/content";
import { creators } from "@/db/schema/creators";
import { sendEmail, EmailError } from "@/lib/email";

import { buildFlashcardEmail } from "./email";
import {
  generateFlashcards,
  type FlashcardCard,
} from "./generate";
import {
  describeSource,
  resolveFlashcardSource,
  type FlashcardSkipReason,
  type SourceCachedTranscript,
  type SourceLessonInput,
} from "./source";
import {
  buildSendIdempotencyKey,
  filterDueCompletions,
  type CompletionRecord,
} from "./timing";

// Days 11-13 — wires the pure libs to the DB, Anthropic, and Resend.
//
// Two entrypoints:
//   - resolveLessonContent(lessonId, creatorId): runs the source tree
//     for a single lesson, persists a lesson_content row + flashcards
//     row when usable, returns a structured outcome the UI can render.
//   - dispatchFlashcardSends(creatorId, now): walks the 24-48h window
//     of completed lessons, sends one Resend email per (member, lesson)
//     that doesn't already have a send row.
//
// Both are idempotent. flashcards has a unique idx on lessonId; we
// upsert. flashcard_sends has a unique idx on (memberId, lessonId);
// we ignore conflict.

type SkipReasonValue = (typeof skipReasonEnum.enumValues)[number];
type TranscriptSourceValue = (typeof transcriptSourceEnum.enumValues)[number];
type FlashcardSendStatusValue = (typeof flashcardSendStatusEnum.enumValues)[number];

// Skip reasons our UI surfaces when the audio worker isn't online yet.
// We deliberately reuse the existing enum values instead of widening
// the schema — flagging this in the master plan.
const SKIP_WHISPER_PENDING_REASON: SkipReasonValue = "thin_signal";

export interface ResolveResult {
  lessonId: string;
  status: "generated" | "regenerated" | "skipped" | "deferred";
  /** What the source tree decided. */
  source: TranscriptSourceValue;
  skipReason: SkipReasonValue | null;
  /** Cards persisted (only when status is "generated" or "regenerated"). */
  cards: FlashcardCard[] | null;
  /** Human label for the per-lesson source pill. */
  label: string;
}

/**
 * Run the source tree + (optional) generation for one lesson and
 * persist the results. Caller scopes by creatorId so cross-tenant
 * lessons can never be touched.
 */
export async function resolveLessonContent(opts: {
  lessonId: string;
  creatorId: string;
  /** Defaults to ANTHROPIC_API_KEY at runtime. */
  apiKey?: string | null;
}): Promise<ResolveResult> {
  const { lessonId, creatorId, apiKey } = opts;

  const [lessonRow] = await db
    .select({
      id: lessons.id,
      title: lessons.title,
      description: lessons.description,
      descriptionWordCount: lessons.descriptionWordCount,
      attachedDocUrl: lessons.attachedDocUrl,
      videoUrl: lessons.videoUrl,
      durationSeconds: lessons.durationSeconds,
      thumbnailUrl: lessons.thumbnailUrl,
    })
    .from(lessons)
    .innerJoin(courses, eq(courses.id, lessons.courseId))
    .where(eq(lessons.id, lessonId));
  if (!lessonRow) throw new Error(`lesson_not_found:${lessonId}`);

  const [creatorRow] = await db
    .select({
      transcriptionEnabled: creators.transcriptionEnabled,
      transcriptionMinutesQuota: creators.transcriptionMinutesQuota,
    })
    .from(creators)
    .where(eq(creators.id, creatorId));
  if (!creatorRow) throw new Error(`creator_not_found:${creatorId}`);

  const minutesUsedThisMonth = await sumTranscriptionMinutesThisMonth(
    creatorId,
    new Date(),
  );

  const cached = await loadLatestCachedTranscript(lessonId);

  const sourceLesson: SourceLessonInput = {
    id: lessonRow.id,
    title: lessonRow.title,
    description: lessonRow.description,
    descriptionWordCount: lessonRow.descriptionWordCount,
    attachedDocUrl: lessonRow.attachedDocUrl,
    videoUrl: lessonRow.videoUrl,
    durationSeconds: lessonRow.durationSeconds,
  };

  const decision = resolveFlashcardSource({
    lesson: sourceLesson,
    cachedTranscript: cached,
    creator: {
      transcriptionEnabled: creatorRow.transcriptionEnabled,
      transcriptionMinutesQuota: creatorRow.transcriptionMinutesQuota,
      minutesUsedThisMonth,
    },
    pdfText: null,
  });

  // Step 6 transcribe path: defer cleanly. The audio worker isn't in
  // this sprint (see the architectural flag in the day's PR notes).
  if (decision.kind === "transcribe") {
    const skipReason = SKIP_WHISPER_PENDING_REASON;
    const contentId = await upsertSkippedContent(lessonId, skipReason);
    return {
      lessonId,
      status: "deferred",
      source: "skipped",
      skipReason,
      cards: null,
      label: "Whisper rollout in progress — toggle on now to be queued",
    };
  }

  if (decision.kind === "skip") {
    const skipReason = decision.reason as SkipReasonValue;
    await upsertSkippedContent(lessonId, skipReason);
    return {
      lessonId,
      status: "skipped",
      source: "skipped",
      skipReason,
      cards: null,
      label: describeSource("skipped", decision.reason).label,
    };
  }

  // decision.kind === "use" → generate cards.
  const persistedSource: TranscriptSourceValue = decision.source;
  const sourceContentId = decision.sourceContentId
    ?? (await upsertUsableContent({
      lessonId,
      source: persistedSource,
      text: decision.text,
    }));

  const generated = await generateFlashcards(
    { lesson: sourceLesson, sourceText: decision.text },
    { apiKey: apiKey ?? null },
  );

  await upsertFlashcards({
    lessonId,
    cards: generated.cards,
    model: generated.model,
    sourceContentId,
  });

  return {
    lessonId,
    status: "generated",
    source: persistedSource,
    skipReason: null,
    cards: generated.cards,
    label: describeSource(persistedSource, null).label,
  };
}

// ---------------------------------------------------------------------------
// Send orchestrator: 24-48h after completion, one email per (member, lesson)
// ---------------------------------------------------------------------------

export interface DispatchOpts {
  /** Scope: only this creator's communities. */
  creatorId: string;
  /** Test seam — defaults to `new Date()`. */
  now?: Date;
  /** Dry run skips the Resend HTTP + DB writes. Used by /flashcards preview. */
  dryRun?: boolean;
}

export interface DispatchSummary {
  considered: number;
  sent: number;
  alreadySent: number;
  skippedNoCards: number;
  skippedNoEmail: number;
  failed: number;
  errors: Array<{ memberId: string; lessonId: string; reason: string }>;
}

export async function dispatchFlashcardSends(
  opts: DispatchOpts,
): Promise<DispatchSummary> {
  const now = opts.now ?? new Date();
  const summary: DispatchSummary = {
    considered: 0,
    sent: 0,
    alreadySent: 0,
    skippedNoCards: 0,
    skippedNoEmail: 0,
    failed: 0,
    errors: [],
  };

  // Pull every member-lesson completion in the last 60h for this creator
  // (slightly wider than the 48h upper bound so the window filter has
  // a real boundary to apply, and we never miss late entries).
  const lookbackMs = 60 * 3_600_000;
  const since = new Date(now.getTime() - lookbackMs);

  const completions = await db
    .select({
      memberId: memberProgress.memberId,
      lessonId: memberProgress.lessonId,
      completedAt: memberProgress.completedAt,
    })
    .from(memberProgress)
    .innerJoin(members, eq(members.id, memberProgress.memberId))
    .innerJoin(lessons, eq(lessons.id, memberProgress.lessonId))
    .innerJoin(courses, eq(courses.id, lessons.courseId))
    .innerJoin(
      // creator scope: course → community → creator
      sql`(
        SELECT c.id AS community_id
        FROM communities c
        WHERE c.creator_id = ${creatorId(opts.creatorId)}
      ) AS scoped_communities`,
      sql`courses.community_id = scoped_communities.community_id`,
    )
    .where(
      and(
        isNotNull(memberProgress.completedAt),
        gte(memberProgress.completedAt, since),
        lt(memberProgress.completedAt, now),
      ),
    );

  const records: CompletionRecord[] = completions
    .filter((c): c is typeof c & { completedAt: Date } => c.completedAt !== null)
    .map((c) => ({
      memberId: c.memberId,
      lessonId: c.lessonId,
      completedAt: c.completedAt,
    }));

  const due = filterDueCompletions(records, now);
  summary.considered = due.length;
  if (due.length === 0) return summary;

  // Pull existing send rows in bulk so we can dedupe in memory.
  const memberIds = Array.from(new Set(due.map((d) => d.memberId)));
  const lessonIds = Array.from(new Set(due.map((d) => d.lessonId)));

  const existingSends = await db
    .select({
      memberId: flashcardSends.memberId,
      lessonId: flashcardSends.lessonId,
      status: flashcardSends.status,
    })
    .from(flashcardSends)
    .where(
      and(
        inArray(flashcardSends.memberId, memberIds),
        inArray(flashcardSends.lessonId, lessonIds),
      ),
    );
  const sentLookup = new Set(
    existingSends.map((s) => `${s.memberId}:${s.lessonId}`),
  );

  // Pull lesson titles + position + any existing flashcards rows.
  const lessonMeta = await db
    .select({
      id: lessons.id,
      title: lessons.title,
      positionInCourse: lessons.positionInCourse,
      cards: flashcards.cards,
    })
    .from(lessons)
    .leftJoin(flashcards, eq(flashcards.lessonId, lessons.id))
    .where(inArray(lessons.id, lessonIds));
  const lessonLookup = new Map(lessonMeta.map((l) => [l.id, l]));

  const memberMeta = await db
    .select({ id: members.id, name: members.name, email: members.email })
    .from(members)
    .where(inArray(members.id, memberIds));
  const memberLookup = new Map(memberMeta.map((m) => [m.id, m]));

  for (const due_ of due) {
    const key = `${due_.memberId}:${due_.lessonId}`;
    if (sentLookup.has(key)) {
      summary.alreadySent += 1;
      continue;
    }
    const lesson = lessonLookup.get(due_.lessonId);
    const member = memberLookup.get(due_.memberId);
    if (!lesson || !lesson.cards) {
      summary.skippedNoCards += 1;
      continue;
    }
    if (!member || !member.email) {
      summary.skippedNoEmail += 1;
      continue;
    }
    const cards = parseStoredCards(lesson.cards);
    if (!cards) {
      summary.skippedNoCards += 1;
      continue;
    }

    const firstName = (member.name ?? "").split(/\s+/)[0] || "there";
    const email = buildFlashcardEmail({
      firstName,
      lessonTitle: lesson.title,
      cards,
      lessonLabel: `Lesson ${lesson.positionInCourse}`,
    });

    if (opts.dryRun) {
      summary.sent += 1;
      continue;
    }

    try {
      await db
        .insert(flashcardSends)
        .values({
          memberId: due_.memberId,
          lessonId: due_.lessonId,
          status: "queued" as FlashcardSendStatusValue,
          queuedAt: now,
        })
        .onConflictDoNothing({
          target: [flashcardSends.memberId, flashcardSends.lessonId],
        });

      const result = await sendEmail({
        to: member.email,
        subject: email.subject,
        html: email.html,
        text: email.text,
        idempotencyKey: buildSendIdempotencyKey(
          due_.memberId,
          due_.lessonId,
        ),
        tags: [
          { name: "feature", value: "flashcards" },
          { name: "lesson_id", value: due_.lessonId },
        ],
      });

      await db
        .update(flashcardSends)
        .set({
          status: "sent",
          resendMessageId: result.id,
          sentAt: new Date(),
        })
        .where(
          and(
            eq(flashcardSends.memberId, due_.memberId),
            eq(flashcardSends.lessonId, due_.lessonId),
          ),
        );
      summary.sent += 1;
    } catch (err) {
      const reason = err instanceof EmailError
        ? `resend_${err.status}: ${err.message}`
        : err instanceof Error
        ? err.message
        : String(err);
      await db
        .update(flashcardSends)
        .set({
          status: "failed",
          failureReason: reason.slice(0, 240),
        })
        .where(
          and(
            eq(flashcardSends.memberId, due_.memberId),
            eq(flashcardSends.lessonId, due_.lessonId),
          ),
        );
      summary.failed += 1;
      summary.errors.push({
        memberId: due_.memberId,
        lessonId: due_.lessonId,
        reason,
      });
    }
  }

  return summary;
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function creatorId(value: string) {
  // Drizzle's sql tag doesn't auto-quote; sanitise here. We accept only
  // hex/uuid-shaped strings from getCurrentCreator().
  if (!/^[a-zA-Z0-9_-]+$/.test(value)) throw new Error("invalid_creator_id");
  return sql.raw(`'${value}'`);
}

async function sumTranscriptionMinutesThisMonth(
  creatorId: string,
  now: Date,
): Promise<number> {
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const [row] = await db
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
  return row?.total ?? 0;
}

async function loadLatestCachedTranscript(
  lessonId: string,
): Promise<SourceCachedTranscript | null> {
  const [row] = await db
    .select({
      id: lessonContent.id,
      text: lessonContent.text,
      source: lessonContent.source,
    })
    .from(lessonContent)
    .where(eq(lessonContent.lessonId, lessonId))
    .orderBy(desc(lessonContent.createdAt))
    .limit(1);
  if (!row || row.source === "skipped" || !row.text) return null;
  return {
    id: row.id,
    text: row.text,
    source: row.source as SourceCachedTranscript["source"],
  };
}

async function upsertUsableContent(args: {
  lessonId: string;
  source: TranscriptSourceValue;
  text: string;
}): Promise<string> {
  const hash = hashContent(args.text);
  const [existing] = await db
    .select({ id: lessonContent.id })
    .from(lessonContent)
    .where(
      and(
        eq(lessonContent.lessonId, args.lessonId),
        eq(lessonContent.contentHash, hash),
      ),
    );
  if (existing) return existing.id;

  const inserted = await db
    .insert(lessonContent)
    .values({
      lessonId: args.lessonId,
      source: args.source,
      text: args.text,
      contentHash: hash,
      minutesUsed: 0,
    })
    .returning({ id: lessonContent.id });
  const row = inserted[0];
  if (!row) throw new Error("lesson_content_insert_failed");
  return row.id;
}

async function upsertSkippedContent(
  lessonId: string,
  skipReason: SkipReasonValue,
): Promise<string> {
  const hash = hashContent(`SKIPPED:${skipReason}`);
  const [existing] = await db
    .select({ id: lessonContent.id })
    .from(lessonContent)
    .where(
      and(
        eq(lessonContent.lessonId, lessonId),
        eq(lessonContent.contentHash, hash),
      ),
    );
  if (existing) return existing.id;

  const inserted = await db
    .insert(lessonContent)
    .values({
      lessonId,
      source: "skipped",
      skipReason,
      text: null,
      contentHash: hash,
      minutesUsed: 0,
    })
    .returning({ id: lessonContent.id });
  const row = inserted[0];
  if (!row) throw new Error("lesson_content_insert_failed");
  return row.id;
}

async function upsertFlashcards(args: {
  lessonId: string;
  cards: FlashcardCard[];
  model: string;
  sourceContentId: string;
}) {
  await db
    .insert(flashcards)
    .values({
      lessonId: args.lessonId,
      cards: args.cards,
      model: args.model,
      sourceContentId: args.sourceContentId,
      generatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: flashcards.lessonId,
      set: {
        cards: args.cards,
        model: args.model,
        sourceContentId: args.sourceContentId,
        generatedAt: new Date(),
      },
    });
}

function hashContent(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 32);
}

function parseStoredCards(value: unknown): FlashcardCard[] | null {
  if (!Array.isArray(value)) return null;
  const out: FlashcardCard[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const obj = item as Record<string, unknown>;
    if (typeof obj.question !== "string" || typeof obj.answer !== "string") continue;
    out.push({ question: obj.question, answer: obj.answer });
  }
  return out.length > 0 ? out : null;
}
