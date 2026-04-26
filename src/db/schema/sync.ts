import { sql } from "drizzle-orm";
import {
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

import { communities } from "./communities";

// One row per attempt to refresh data for a community. Acts as both
// an audit log (so we can debug "why is the page wrong?") and a
// concurrency lock — `status = 'running'` rows younger than the
// stale-window block new runs from starting.
//
// We keep this as a separate table rather than columns on `communities`
// because Member Check-ins (Days 8-10) and the Weekly Report (Days 12+)
// will both want to ask "what happened in the last successful sync?"
// — having start/finish timestamps + per-step counters per run makes
// that a single query later.

export const syncTriggerEnum = pgEnum("sync_trigger", ["cron", "manual", "connect"]);

export const syncStatusEnum = pgEnum("sync_status", [
  "running",
  "succeeded",
  "partial",
  "failed",
]);

export const syncRuns = pgTable(
  "sync_runs",
  {
    id: text("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),

    communityId: text("community_id")
      .notNull()
      .references(() => communities.id, { onDelete: "cascade" }),

    trigger: syncTriggerEnum("trigger").notNull(),
    status: syncStatusEnum("status").notNull().default("running"),

    startedAt: timestamp("started_at", { mode: "date" }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { mode: "date" }),
    durationMs: integer("duration_ms"),

    // Per-step counters. Day 4 only fills the first two; Day 5+ fills
    // members/progress as we wire member discovery + progression.
    coursesUpserted: integer("courses_upserted").notNull().default(0),
    lessonsUpserted: integer("lessons_upserted").notNull().default(0),
    membersUpserted: integer("members_upserted").notNull().default(0),
    progressUpserted: integer("progress_upserted").notNull().default(0),
    apiCalls: integer("api_calls").notNull().default(0),

    // Set when status = 'failed'. errorStep narrows which sub-step
    // exploded, so the cron summary can group failures by cause.
    errorMessage: text("error_message"),
    errorStep: text("error_step"),

    // Non-fatal sub-step warnings collected during a 'partial' run.
    // Shape: Array<{ step: string; message: string; detail?: unknown }>
    warnings: jsonb("warnings"),
  },
  (t) => ({
    // Most queries are "latest sync for this community" or "list recent
    // runs for this community" — both served by this composite.
    communityRecentIdx: index("sync_runs_community_recent_idx").on(
      t.communityId,
      t.startedAt,
    ),
  }),
);
