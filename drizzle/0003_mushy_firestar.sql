CREATE TABLE "community_metrics_daily" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"community_id" text NOT NULL,
	"metric_date" date NOT NULL,
	"total_members" integer,
	"active_members" integer,
	"daily_activities" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "community_metrics_daily" ADD CONSTRAINT "community_metrics_daily_community_id_communities_id_fk" FOREIGN KEY ("community_id") REFERENCES "public"."communities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "community_metrics_daily_idx" ON "community_metrics_daily" USING btree ("community_id","metric_date");