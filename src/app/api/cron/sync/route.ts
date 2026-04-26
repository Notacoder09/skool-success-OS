import "server-only";

import { eq } from "drizzle-orm";

import { db } from "@/db";
import { communities } from "@/db/schema/communities";
import { skoolCredentials } from "@/db/schema/creators";
import { syncRuns } from "@/db/schema/sync";
import { decrypt, parseSkoolCookies } from "@/lib/crypto";
import { syncCommunity, SyncAlreadyRunningError, STALE_RUNNING_WINDOW_MS } from "@/lib/sync";

// Vercel Cron pings this endpoint on the schedule defined in vercel.json
// (every 6h by default). On request, we:
//   1. Authenticate via Bearer ${CRON_SECRET} (Vercel Cron sends this
//      header automatically once configured)
//   2. Reap any 'running' sync_runs older than the stale window
//      (presumed crashed in a previous invocation)
//   3. For each community whose creator has active credentials, run
//      syncCommunity sequentially. Sequential intentionally — Skool's
//      undocumented API is the rate-limit bottleneck, not us.

export const dynamic = "force-dynamic";
// Vercel Hobby = 60s, Pro = 300s. Even Hobby is enough for a few
// communities per run; the cron is best-effort either way.
export const maxDuration = 60;

interface RunSummary {
  communityId: string;
  status: "succeeded" | "partial" | "failed" | "skipped" | "error";
  details?: string;
}

export async function GET(req: Request) {
  const authHeader = req.headers.get("authorization");
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    return Response.json(
      { error: "CRON_SECRET not configured" },
      { status: 500 },
    );
  }
  if (authHeader !== `Bearer ${expected}`) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const reaped = await reapStaleRunningRuns();

  // Pull every (community, active credential) pair in a single query.
  // We need both the encrypted blob and the group ID per community.
  const targets = await db
    .select({
      communityId: communities.id,
      skoolGroupId: communities.skoolGroupId,
      ciphertext: skoolCredentials.ciphertext,
      iv: skoolCredentials.iv,
      authTag: skoolCredentials.authTag,
      keyVersion: skoolCredentials.keyVersion,
    })
    .from(communities)
    .innerJoin(skoolCredentials, eq(skoolCredentials.creatorId, communities.creatorId))
    .where(eq(skoolCredentials.status, "active"));

  const summaries: RunSummary[] = [];

  for (const t of targets) {
    let cookies;
    try {
      const plaintext = decrypt({
        ciphertext: t.ciphertext,
        iv: t.iv,
        authTag: t.authTag,
        keyVersion: t.keyVersion,
      });
      cookies = parseSkoolCookies(plaintext);
    } catch (err) {
      summaries.push({
        communityId: t.communityId,
        status: "error",
        details: `decrypt_failed: ${err instanceof Error ? err.message : String(err)}`,
      });
      continue;
    }

    try {
      const result = await syncCommunity({
        communityId: t.communityId,
        skoolGroupId: t.skoolGroupId,
        cookies,
        trigger: "cron",
      });
      summaries.push({
        communityId: t.communityId,
        status: result.status === "running" ? "error" : result.status,
        details:
          result.errorMessage ??
          `${result.coursesUpserted}c/${result.lessonsUpserted}l in ${result.durationMs}ms`,
      });
    } catch (err) {
      if (err instanceof SyncAlreadyRunningError) {
        summaries.push({ communityId: t.communityId, status: "skipped" });
      } else {
        summaries.push({
          communityId: t.communityId,
          status: "error",
          details: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  return Response.json({
    ok: true,
    reapedStaleRuns: reaped,
    ranAt: new Date().toISOString(),
    summaries,
  });
}

// Mark any 'running' sync_runs older than STALE_RUNNING_WINDOW_MS as
// failed. Without this, a crashed sync would block all future syncs
// for that community until we manually intervened.
async function reapStaleRunningRuns(): Promise<number> {
  const staleBefore = new Date(Date.now() - STALE_RUNNING_WINDOW_MS);
  const stale = await db
    .select({ id: syncRuns.id })
    .from(syncRuns)
    .where(eq(syncRuns.status, "running"));

  let reaped = 0;
  for (const row of stale) {
    // Re-check per-row: select returned everything 'running', but we
    // only want to reap the ones older than the window.
    const [fresh] = await db
      .select({ startedAt: syncRuns.startedAt })
      .from(syncRuns)
      .where(eq(syncRuns.id, row.id));
    if (!fresh || fresh.startedAt > staleBefore) continue;
    await db
      .update(syncRuns)
      .set({
        status: "failed",
        finishedAt: new Date(),
        errorMessage: "Run abandoned (process crashed or timed out)",
        errorStep: "reaper",
      })
      .where(eq(syncRuns.id, row.id));
    reaped += 1;
  }
  return reaped;
}
