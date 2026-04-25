import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { creators } from "./creators";

export const memberSourceEnum = pgEnum("member_source", ["api", "csv", "harvest", "manual"]);

export const communities = pgTable(
  "communities",
  {
    id: text("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    creatorId: text("creator_id")
      .notNull()
      .references(() => creators.id, { onDelete: "cascade" }),
    skoolGroupId: text("skool_group_id").notNull(),
    name: text("name"),
    slug: text("slug"),
    isPrimary: boolean("is_primary").notNull().default(true),
    lastSyncedAt: timestamp("last_synced_at", { mode: "date" }),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
  },
  (t) => ({
    creatorGroupIdx: uniqueIndex("communities_creator_group_idx").on(
      t.creatorId,
      t.skoolGroupId,
    ),
  }),
);

export const courses = pgTable(
  "courses",
  {
    id: text("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    communityId: text("community_id")
      .notNull()
      .references(() => communities.id, { onDelete: "cascade" }),
    skoolCourseId: text("skool_course_id").notNull(),
    title: text("title").notNull(),
    isPrimary: boolean("is_primary").notNull().default(false),
    enrolledCount: integer("enrolled_count"),
    completedCount: integer("completed_count"),
    lastSyncedAt: timestamp("last_synced_at", { mode: "date" }),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
  },
  (t) => ({
    communityCourseIdx: uniqueIndex("courses_community_course_idx").on(
      t.communityId,
      t.skoolCourseId,
    ),
  }),
);

export const lessons = pgTable(
  "lessons",
  {
    id: text("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    courseId: text("course_id")
      .notNull()
      .references(() => courses.id, { onDelete: "cascade" }),
    skoolLessonId: text("skool_lesson_id").notNull(),

    title: text("title").notNull(),
    // Position within the course (1-indexed). Used for "Lesson 3" labels in
    // the drop-off map and AI insight prompts.
    positionInCourse: integer("position_in_course").notNull(),
    isOptional: boolean("is_optional").notNull().default(false),

    // Free metadata used by ADR-0005 sourcing pipeline.
    description: text("description"),
    descriptionWordCount: integer("description_word_count"),
    attachedDocUrl: text("attached_doc_url"),
    videoUrl: text("video_url"),
    thumbnailUrl: text("thumbnail_url"),
    durationSeconds: integer("duration_seconds"),

    // % of enrolled members who completed this lesson.
    completionPct: numeric("completion_pct", { precision: 5, scale: 2 }),

    skoolUpdatedAt: timestamp("skool_updated_at", { mode: "date" }),
    lastSyncedAt: timestamp("last_synced_at", { mode: "date" }),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
  },
  (t) => ({
    courseLessonIdx: uniqueIndex("lessons_course_lesson_idx").on(
      t.courseId,
      t.skoolLessonId,
    ),
    coursePosIdx: index("lessons_course_pos_idx").on(t.courseId, t.positionInCourse),
  }),
);

export const members = pgTable(
  "members",
  {
    id: text("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    communityId: text("community_id")
      .notNull()
      .references(() => communities.id, { onDelete: "cascade" }),

    skoolMemberId: text("skool_member_id"),
    name: text("name"),
    email: text("email"),
    handle: text("handle"),

    // ADR-0004: where we learned about this member.
    source: memberSourceEnum("source").notNull(),

    joinedAt: timestamp("joined_at", { mode: "date" }),
    lastActiveAt: timestamp("last_active_at", { mode: "date" }),

    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow(),
  },
  (t) => ({
    // Skool member ID is unique within a community when present.
    communitySkoolIdx: uniqueIndex("members_community_skool_idx")
      .on(t.communityId, t.skoolMemberId)
      .where(sql`${t.skoolMemberId} IS NOT NULL`),
    // Email is unique within a community when present (CSV-imported rows
    // without a Skool ID still need dedupe).
    communityEmailIdx: uniqueIndex("members_community_email_idx")
      .on(t.communityId, t.email)
      .where(sql`${t.email} IS NOT NULL`),
  }),
);

export const memberProgress = pgTable(
  "member_progress",
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

    completionPct: numeric("completion_pct", { precision: 5, scale: 2 }),
    completedAt: timestamp("completed_at", { mode: "date" }),
    lastActivityAt: timestamp("last_activity_at", { mode: "date" }),

    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow(),
  },
  (t) => ({
    memberLessonIdx: uniqueIndex("progress_member_lesson_idx").on(t.memberId, t.lessonId),
  }),
);
