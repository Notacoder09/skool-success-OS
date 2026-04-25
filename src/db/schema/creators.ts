import { sql } from "drizzle-orm";
import { boolean, integer, pgEnum, pgTable, text, timestamp } from "drizzle-orm/pg-core";

import { users } from "./auth";

export const cohortEnum = pgEnum("cohort", ["beta", "founding", "starter", "pro", "agency"]);

export const credentialStatusEnum = pgEnum("credential_status", [
  "active",
  "expired",
  "revoked",
]);

// Domain profile for a creator. 1:1 with `users` (Auth.js).
// Splitting domain fields off `users` keeps the Auth.js table at its
// standard shape so we can upgrade the adapter cleanly later.
export const creators = pgTable("creators", {
  id: text("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),

  userId: text("user_id")
    .notNull()
    .unique()
    .references(() => users.id, { onDelete: "cascade" }),

  // ADR-0006: auto-detected from browser on first session.
  // IANA name (e.g. "America/New_York"). Falls back to "UTC".
  timezone: text("timezone").notNull().default("UTC"),

  // ADR-0008: beta cohort auto-converts to founding tier.
  cohort: cohortEnum("cohort").notNull().default("beta"),
  foundingEligible: boolean("founding_eligible").notNull().default(true),

  // Master plan Feature 2: transcription default OFF; creator opts in.
  transcriptionEnabled: boolean("transcription_enabled").notNull().default(false),

  // Per-month minute quota. Founding=250, Starter=500, Pro=2000, Agency=unlimited.
  // Beta seed = 1000 per master plan Part 7.
  transcriptionMinutesQuota: integer("transcription_minutes_quota").notNull().default(1000),

  createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow(),
});

// ADR-0003: AES-256-GCM at rest, key in env, key-versioned for rotation.
// Plaintext cookies never written to logs.
export const skoolCredentials = pgTable("skool_credentials", {
  id: text("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),

  creatorId: text("creator_id")
    .notNull()
    .unique()
    .references(() => creators.id, { onDelete: "cascade" }),

  // Skool's own user ID associated with the pasted session, captured the
  // first time we successfully call /me with the cookies. Lets us guard
  // against creators trying to act on a community they don't own.
  skoolUserId: text("skool_user_id"),

  // Encrypted blob containing { auth_token, client_id }.
  ciphertext: text("ciphertext").notNull(),
  iv: text("iv").notNull(),
  authTag: text("auth_tag").notNull(),
  keyVersion: integer("key_version").notNull(),

  status: credentialStatusEnum("status").notNull().default("active"),
  lastVerifiedAt: timestamp("last_verified_at", { mode: "date" }),
  lastFailureReason: text("last_failure_reason"),

  createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow(),
});
