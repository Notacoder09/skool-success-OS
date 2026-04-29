import "server-only";

import { db } from "@/db";
import { creators } from "@/db/schema/creators";
import {
  buildAndSendWeeklyReport,
  type BuildOutcome,
} from "@/lib/weekly-report/orchestrator";

// Days 11-13 — Weekly Optimization Report cron.
//
// Runs hourly UTC. For each creator we evaluate "is it Monday 7am
// in their timezone right now?" inside the orchestrator (via
// `evaluateMondaySchedule`); creators whose local clocks don't
// match are skipped with reason="schedule_not_due".
//
// Idempotency lives in two places:
//   - weekly_reports unique idx (creator_id, week_start_date) — one
//     row per creator per week.
//   - Resend Idempotency-Key header — same week never produces two
//     emails, even if the cron runs twice in the same hour.

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    return Response.json(
      { error: "CRON_SECRET not configured" },
      { status: 500 },
    );
  }
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${expected}`) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const rows = await db.select({ id: creators.id }).from(creators);
  const now = new Date();

  const summaries: Array<{
    creatorId: string;
    outcome: BuildOutcome | { ok: false; reason: "error"; message: string };
  }> = [];

  for (const row of rows) {
    try {
      const outcome = await buildAndSendWeeklyReport({
        creatorId: row.id,
        now,
      });
      summaries.push({ creatorId: row.id, outcome });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      summaries.push({
        creatorId: row.id,
        outcome: { ok: false, reason: "error", message },
      });
    }
  }

  const sent = summaries.filter(
    (s) => s.outcome.ok && s.outcome.emailMessageId !== null,
  ).length;
  const skippedNotDue = summaries.filter(
    (s) => !s.outcome.ok && "reason" in s.outcome && s.outcome.reason === "schedule_not_due",
  ).length;
  const errors = summaries.filter(
    (s) => !s.outcome.ok && "reason" in s.outcome && s.outcome.reason === "error",
  ).length;

  return Response.json({
    ok: true,
    ranAt: now.toISOString(),
    creatorsConsidered: rows.length,
    sent,
    skippedNotDue,
    errors,
    summaries,
  });
}
