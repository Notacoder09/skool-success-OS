import { sql } from "drizzle-orm";
import {
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { lessons, members } from "./communities";
import { creators } from "./creators";

// ADR-0005 source attribution. Surface to creator per-lesson, never
// silently transcribe or skip.
export const transcriptSourceEnum = pgEnum("transcript_source", [
  "description",
  "pdf",
  "cached",
  "whisper",
  "skipped",
]);

export const skipReasonEnum = pgEnum("skip_reason", [
  "thin_signal",
  "transcription_disabled",
  "quota_reached",
  "fetch_failed",
  "creator_disabled_lesson",
]);

export const flashcardSendStatusEnum = pgEnum("flashcard_send_status", [
  "queued",
  "sent",
  "delivered",
  "opened",
  "bounced",
  "failed",
  "suppressed",
]);

// Cached lesson content used to generate flashcards. Keyed by
// (lesson, content_hash) so we never re-transcribe the same lesson
// unless the creator updates it (hash changes).
export const lessonContent = pgTable(
  "lesson_content",
  {
    id: text("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    lessonId: text("lesson_id")
      .notNull()
      .references(() => lessons.id, { onDelete: "cascade" }),
    source: transcriptSourceEnum("source").notNull(),
    skipReason: skipReasonEnum("skip_reason"),
    text: text("text"),
    contentHash: text("content_hash").notNull(),
    minutesUsed: integer("minutes_used").notNull().default(0),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
  },
  (t) => ({
    lessonHashIdx: uniqueIndex("lesson_content_lesson_hash_idx").on(
      t.lessonId,
      t.contentHash,
    ),
  }),
);

// Per-creator quota ledger. Sum-by-month for the cap, history for support.
export const transcriptionUsage = pgTable(
  "transcription_usage",
  {
    id: text("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    creatorId: text("creator_id")
      .notNull()
      .references(() => creators.id, { onDelete: "cascade" }),
    lessonId: text("lesson_id")
      .notNull()
      .references(() => lessons.id, { onDelete: "cascade" }),
    minutesUsed: integer("minutes_used").notNull(),
    ranAt: timestamp("ran_at", { mode: "date" }).notNull().defaultNow(),
  },
  (t) => ({
    creatorMonthIdx: index("usage_creator_month_idx").on(t.creatorId, t.ranAt),
  }),
);

// Generated flashcards per lesson. Cards stored as JSONB for fast read,
// regenerated when source content changes.
export const flashcards = pgTable("flashcards", {
  id: text("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  lessonId: text("lesson_id")
    .notNull()
    .unique()
    .references(() => lessons.id, { onDelete: "cascade" }),
  // Array of { question, answer } objects. Capped 3-5 per master plan.
  cards: jsonb("cards").notNull(),
  sourceContentId: text("source_content_id").references(() => lessonContent.id),
  generatedAt: timestamp("generated_at", { mode: "date" }).notNull().defaultNow(),
  model: text("model").notNull(),
});

// Per-member, per-lesson email send. Member emails come from API or
// CSV (ADR-0004); we never spam, never re-send for the same lesson.
export const flashcardSends = pgTable(
  "flashcard_sends",
  {
    id: text("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    memberId: text("member_id")
      .notNull()
      .references(() => members.id, { onDelete: "cascade" }),
    lessonId: text("lesson_id")
      .notNull()
      .references(() => lessons.id, { onDelete: "cascade" }),
    status: flashcardSendStatusEnum("status").notNull().default("queued"),
    resendMessageId: text("resend_message_id"),
    queuedAt: timestamp("queued_at", { mode: "date" }).notNull().defaultNow(),
    sentAt: timestamp("sent_at", { mode: "date" }),
    openedAt: timestamp("opened_at", { mode: "date" }),
    failureReason: text("failure_reason"),
  },
  (t) => ({
    memberLessonIdx: uniqueIndex("flashcard_sends_member_lesson_idx").on(
      t.memberId,
      t.lessonId,
    ),
  }),
);
