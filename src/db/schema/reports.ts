import { sql } from "drizzle-orm";
import { date, jsonb, pgEnum, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

import { members } from "./communities";
import { creators } from "./creators";
import { lessons } from "./communities";

export const checkInStatusEnum = pgEnum("check_in_status", [
  "suggested",
  "drafted",
  "copied",
  "dismissed",
  "sent",
]);

export const reportVariantEnum = pgEnum("report_variant", ["welcome", "weekly"]);

// Member Check-ins (Feature 4). Daily list capped at 5-7 names.
export const memberCheckIns = pgTable(
  "member_check_ins",
  {
    id: text("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    creatorId: text("creator_id")
      .notNull()
      .references(() => creators.id, { onDelete: "cascade" }),
    memberId: text("member_id")
      .notNull()
      .references(() => members.id, { onDelete: "cascade" }),
    suggestedAt: timestamp("suggested_at", { mode: "date" }).notNull().defaultNow(),
    // Plain-language flag reason shown in the UI ("hasn't logged in for 2 weeks, used to post weekly").
    reason: text("reason").notNull(),
    // Drafted message variants by tone (sam/hamza/professional).
    draftMessages: jsonb("draft_messages"),
    status: checkInStatusEnum("status").notNull().default("suggested"),
    lastTouchedAt: timestamp("last_touched_at", { mode: "date" }),
  },
  (t) => ({
    creatorMemberDayIdx: uniqueIndex("check_ins_creator_member_day_idx").on(
      t.creatorId,
      t.memberId,
      t.suggestedAt,
    ),
  }),
);

// AI-generated drop-off insight per lesson (Feature 1). Cached so the
// click-to-zoom interaction is instant; regenerated when the drop-off
// pattern materially changes.
export const lessonInsights = pgTable("lesson_insights", {
  id: text("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  lessonId: text("lesson_id")
    .notNull()
    .unique()
    .references(() => lessons.id, { onDelete: "cascade" }),
  body: text("body").notNull(),
  model: text("model").notNull(),
  generatedAt: timestamp("generated_at", { mode: "date" }).notNull().defaultNow(),
});

// Weekly Optimization Report (Feature 5). Monday 7am creator-local.
export const weeklyReports = pgTable(
  "weekly_reports",
  {
    id: text("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    creatorId: text("creator_id")
      .notNull()
      .references(() => creators.id, { onDelete: "cascade" }),
    weekStartDate: date("week_start_date", { mode: "date" }).notNull(),
    variant: reportVariantEnum("variant").notNull().default("weekly"),
    bodyMd: text("body_md").notNull(),
    queuedAt: timestamp("queued_at", { mode: "date" }).notNull().defaultNow(),
    sentAt: timestamp("sent_at", { mode: "date" }),
    openedAt: timestamp("opened_at", { mode: "date" }),
    resendMessageId: text("resend_message_id"),
  },
  (t) => ({
    creatorWeekIdx: uniqueIndex("weekly_reports_creator_week_idx").on(
      t.creatorId,
      t.weekStartDate,
    ),
  }),
);
