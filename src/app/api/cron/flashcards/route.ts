import "server-only";

import { eq } from "drizzle-orm";

import { db } from "@/db";
import { skoolCredentials } from "@/db/schema/creators";
import {
  dispatchFlashcardSends,
  type DispatchSummary,
} from "@/lib/flashcards/orchestrator";

// Days 11-13 — flashcard send cron.
//
// Pings hourly. For each creator with an active Skool credential we
// dispatch the 24-48h send window once. The dispatcher is idempotent
// (unique idx on flashcard_sends + Resend Idempotency-Key) so a doubled
// invocation can never double-send.
//
// We deliberately don't gate on "did anything happen since last cron" —
// the dispatcher is cheap when there are no due completions and the
// safety from idempotency is more valuable than micro-optimisation.

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

  const creators = await db
    .select({ creatorId: skoolCredentials.creatorId })
    .from(skoolCredentials)
    .where(eq(skoolCredentials.status, "active"));

  const now = new Date();
  const summaries: Array<{ creatorId: string } & DispatchSummary> = [];

  for (const c of creators) {
    try {
      const result = await dispatchFlashcardSends({
        creatorId: c.creatorId,
        now,
      });
      summaries.push({ creatorId: c.creatorId, ...result });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      summaries.push({
        creatorId: c.creatorId,
        considered: 0,
        sent: 0,
        alreadySent: 0,
        skippedNoCards: 0,
        skippedNoEmail: 0,
        failed: 0,
        errors: [{ memberId: "", lessonId: "", reason }],
      });
    }
  }

  return Response.json({ ok: true, ranAt: now.toISOString(), summaries });
}
