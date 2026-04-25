CREATE TYPE "public"."cohort" AS ENUM('beta', 'founding', 'starter', 'pro', 'agency');--> statement-breakpoint
CREATE TYPE "public"."credential_status" AS ENUM('active', 'expired', 'revoked');--> statement-breakpoint
CREATE TYPE "public"."member_source" AS ENUM('api', 'csv', 'harvest', 'manual');--> statement-breakpoint
CREATE TYPE "public"."flashcard_send_status" AS ENUM('queued', 'sent', 'delivered', 'opened', 'bounced', 'failed', 'suppressed');--> statement-breakpoint
CREATE TYPE "public"."skip_reason" AS ENUM('thin_signal', 'transcription_disabled', 'quota_reached', 'fetch_failed', 'creator_disabled_lesson');--> statement-breakpoint
CREATE TYPE "public"."transcript_source" AS ENUM('description', 'pdf', 'cached', 'whisper', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."check_in_status" AS ENUM('suggested', 'drafted', 'copied', 'dismissed', 'sent');--> statement-breakpoint
CREATE TYPE "public"."report_variant" AS ENUM('welcome', 'weekly');--> statement-breakpoint
CREATE TABLE "accounts" (
	"userId" text NOT NULL,
	"type" text NOT NULL,
	"provider" text NOT NULL,
	"providerAccountId" text NOT NULL,
	"refresh_token" text,
	"access_token" text,
	"expires_at" integer,
	"token_type" text,
	"scope" text,
	"id_token" text,
	"session_state" text,
	CONSTRAINT "accounts_provider_providerAccountId_pk" PRIMARY KEY("provider","providerAccountId")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"sessionToken" text PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"expires" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text,
	"email" text NOT NULL,
	"emailVerified" timestamp,
	"image" text,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verificationToken" (
	"identifier" text NOT NULL,
	"token" text NOT NULL,
	"expires" timestamp NOT NULL,
	CONSTRAINT "verificationToken_identifier_token_pk" PRIMARY KEY("identifier","token")
);
--> statement-breakpoint
CREATE TABLE "creators" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"cohort" "cohort" DEFAULT 'beta' NOT NULL,
	"founding_eligible" boolean DEFAULT true NOT NULL,
	"transcription_enabled" boolean DEFAULT false NOT NULL,
	"transcription_minutes_quota" integer DEFAULT 1000 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "creators_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "skool_credentials" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"creator_id" text NOT NULL,
	"skool_user_id" text,
	"ciphertext" text NOT NULL,
	"iv" text NOT NULL,
	"auth_tag" text NOT NULL,
	"key_version" integer NOT NULL,
	"status" "credential_status" DEFAULT 'active' NOT NULL,
	"last_verified_at" timestamp,
	"last_failure_reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "skool_credentials_creator_id_unique" UNIQUE("creator_id")
);
--> statement-breakpoint
CREATE TABLE "communities" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"creator_id" text NOT NULL,
	"skool_group_id" text NOT NULL,
	"name" text,
	"slug" text,
	"is_primary" boolean DEFAULT true NOT NULL,
	"last_synced_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "courses" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"community_id" text NOT NULL,
	"skool_course_id" text NOT NULL,
	"title" text NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"enrolled_count" integer,
	"completed_count" integer,
	"last_synced_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lessons" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"course_id" text NOT NULL,
	"skool_lesson_id" text NOT NULL,
	"title" text NOT NULL,
	"position_in_course" integer NOT NULL,
	"is_optional" boolean DEFAULT false NOT NULL,
	"description" text,
	"description_word_count" integer,
	"attached_doc_url" text,
	"video_url" text,
	"thumbnail_url" text,
	"duration_seconds" integer,
	"completion_pct" numeric(5, 2),
	"skool_updated_at" timestamp,
	"last_synced_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "member_progress" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"member_id" text NOT NULL,
	"lesson_id" text NOT NULL,
	"completion_pct" numeric(5, 2),
	"completed_at" timestamp,
	"last_activity_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "members" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"community_id" text NOT NULL,
	"skool_member_id" text,
	"name" text,
	"email" text,
	"handle" text,
	"source" "member_source" NOT NULL,
	"joined_at" timestamp,
	"last_active_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "flashcard_sends" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"member_id" text NOT NULL,
	"lesson_id" text NOT NULL,
	"status" "flashcard_send_status" DEFAULT 'queued' NOT NULL,
	"resend_message_id" text,
	"queued_at" timestamp DEFAULT now() NOT NULL,
	"sent_at" timestamp,
	"opened_at" timestamp,
	"failure_reason" text
);
--> statement-breakpoint
CREATE TABLE "flashcards" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lesson_id" text NOT NULL,
	"cards" jsonb NOT NULL,
	"source_content_id" text,
	"generated_at" timestamp DEFAULT now() NOT NULL,
	"model" text NOT NULL,
	CONSTRAINT "flashcards_lesson_id_unique" UNIQUE("lesson_id")
);
--> statement-breakpoint
CREATE TABLE "lesson_content" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lesson_id" text NOT NULL,
	"source" "transcript_source" NOT NULL,
	"skip_reason" "skip_reason",
	"text" text,
	"content_hash" text NOT NULL,
	"minutes_used" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transcription_usage" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"creator_id" text NOT NULL,
	"lesson_id" text NOT NULL,
	"minutes_used" integer NOT NULL,
	"ran_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lesson_insights" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lesson_id" text NOT NULL,
	"body" text NOT NULL,
	"model" text NOT NULL,
	"generated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "lesson_insights_lesson_id_unique" UNIQUE("lesson_id")
);
--> statement-breakpoint
CREATE TABLE "member_check_ins" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"creator_id" text NOT NULL,
	"member_id" text NOT NULL,
	"suggested_at" timestamp DEFAULT now() NOT NULL,
	"reason" text NOT NULL,
	"draft_messages" jsonb,
	"status" "check_in_status" DEFAULT 'suggested' NOT NULL,
	"last_touched_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "weekly_reports" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"creator_id" text NOT NULL,
	"week_start_date" date NOT NULL,
	"variant" "report_variant" DEFAULT 'weekly' NOT NULL,
	"body_md" text NOT NULL,
	"queued_at" timestamp DEFAULT now() NOT NULL,
	"sent_at" timestamp,
	"opened_at" timestamp,
	"resend_message_id" text
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creators" ADD CONSTRAINT "creators_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skool_credentials" ADD CONSTRAINT "skool_credentials_creator_id_creators_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creators"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "communities" ADD CONSTRAINT "communities_creator_id_creators_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creators"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "courses" ADD CONSTRAINT "courses_community_id_communities_id_fk" FOREIGN KEY ("community_id") REFERENCES "public"."communities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lessons" ADD CONSTRAINT "lessons_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_progress" ADD CONSTRAINT "member_progress_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_progress" ADD CONSTRAINT "member_progress_lesson_id_lessons_id_fk" FOREIGN KEY ("lesson_id") REFERENCES "public"."lessons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "members" ADD CONSTRAINT "members_community_id_communities_id_fk" FOREIGN KEY ("community_id") REFERENCES "public"."communities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flashcard_sends" ADD CONSTRAINT "flashcard_sends_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flashcard_sends" ADD CONSTRAINT "flashcard_sends_lesson_id_lessons_id_fk" FOREIGN KEY ("lesson_id") REFERENCES "public"."lessons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flashcards" ADD CONSTRAINT "flashcards_lesson_id_lessons_id_fk" FOREIGN KEY ("lesson_id") REFERENCES "public"."lessons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flashcards" ADD CONSTRAINT "flashcards_source_content_id_lesson_content_id_fk" FOREIGN KEY ("source_content_id") REFERENCES "public"."lesson_content"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_content" ADD CONSTRAINT "lesson_content_lesson_id_lessons_id_fk" FOREIGN KEY ("lesson_id") REFERENCES "public"."lessons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transcription_usage" ADD CONSTRAINT "transcription_usage_creator_id_creators_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creators"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transcription_usage" ADD CONSTRAINT "transcription_usage_lesson_id_lessons_id_fk" FOREIGN KEY ("lesson_id") REFERENCES "public"."lessons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_insights" ADD CONSTRAINT "lesson_insights_lesson_id_lessons_id_fk" FOREIGN KEY ("lesson_id") REFERENCES "public"."lessons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_check_ins" ADD CONSTRAINT "member_check_ins_creator_id_creators_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creators"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_check_ins" ADD CONSTRAINT "member_check_ins_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weekly_reports" ADD CONSTRAINT "weekly_reports_creator_id_creators_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creators"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "verification_token_identifier_token_idx" ON "verificationToken" USING btree ("identifier","token");--> statement-breakpoint
CREATE UNIQUE INDEX "communities_creator_group_idx" ON "communities" USING btree ("creator_id","skool_group_id");--> statement-breakpoint
CREATE UNIQUE INDEX "courses_community_course_idx" ON "courses" USING btree ("community_id","skool_course_id");--> statement-breakpoint
CREATE UNIQUE INDEX "lessons_course_lesson_idx" ON "lessons" USING btree ("course_id","skool_lesson_id");--> statement-breakpoint
CREATE INDEX "lessons_course_pos_idx" ON "lessons" USING btree ("course_id","position_in_course");--> statement-breakpoint
CREATE UNIQUE INDEX "progress_member_lesson_idx" ON "member_progress" USING btree ("member_id","lesson_id");--> statement-breakpoint
CREATE UNIQUE INDEX "members_community_skool_idx" ON "members" USING btree ("community_id","skool_member_id") WHERE "members"."skool_member_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "members_community_email_idx" ON "members" USING btree ("community_id","email") WHERE "members"."email" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "flashcard_sends_member_lesson_idx" ON "flashcard_sends" USING btree ("member_id","lesson_id");--> statement-breakpoint
CREATE UNIQUE INDEX "lesson_content_lesson_hash_idx" ON "lesson_content" USING btree ("lesson_id","content_hash");--> statement-breakpoint
CREATE INDEX "usage_creator_month_idx" ON "transcription_usage" USING btree ("creator_id","ran_at");--> statement-breakpoint
CREATE UNIQUE INDEX "check_ins_creator_member_day_idx" ON "member_check_ins" USING btree ("creator_id","member_id","suggested_at");--> statement-breakpoint
CREATE UNIQUE INDEX "weekly_reports_creator_week_idx" ON "weekly_reports" USING btree ("creator_id","week_start_date");