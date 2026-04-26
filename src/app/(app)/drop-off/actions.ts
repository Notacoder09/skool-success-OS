"use server";

import { revalidatePath } from "next/cache";
import { desc, eq } from "drizzle-orm";

import { db } from "@/db";
import { syncRuns } from "@/db/schema/sync";
import { getCurrentCreator, getPrimaryCommunity } from "@/lib/server/creator";
import { loadDecryptedCookiesForCreator } from "@/lib/server/skool-credentials";
import { syncCommunity, SyncAlreadyRunningError } from "@/lib/sync";

// Manual "Refresh now" trigger from the Drop-Off Map page. Re-runs
// the same syncCommunity() the cron uses. The throttle below (60s
// since last run started) protects Skool's undocumented API from a
// creator button-mashing while data loads.

const MANUAL_THROTTLE_MS = 60_000;

export type RefreshResult =
  | { ok: true; message: string; status: "succeeded" | "partial" }
  | {
      ok: false;
      reason: "no_creator" | "no_connection" | "throttled" | "running" | "error";
      message: string;
    };

export async function refreshNow(): Promise<RefreshResult> {
  const creator = await getCurrentCreator();
  if (!creator) {
    return { ok: false, reason: "no_creator", message: "Sign in again." };
  }

  const community = await getPrimaryCommunity(creator.creatorId);
  if (!community) {
    return {
      ok: false,
      reason: "no_connection",
      message: "Connect Skool in Settings first.",
    };
  }

  // Throttle on the most recent run (any status). 60s window is short
  // enough that the button feels responsive but long enough that
  // accidental double-clicks don't trigger two API tours.
  const [recent] = await db
    .select({ startedAt: syncRuns.startedAt })
    .from(syncRuns)
    .where(eq(syncRuns.communityId, community.id))
    .orderBy(desc(syncRuns.startedAt))
    .limit(1);

  if (recent) {
    const sinceMs = Date.now() - recent.startedAt.getTime();
    if (sinceMs < MANUAL_THROTTLE_MS) {
      const wait = Math.ceil((MANUAL_THROTTLE_MS - sinceMs) / 1000);
      return {
        ok: false,
        reason: "throttled",
        message: `Just synced — try again in ${wait}s.`,
      };
    }
  }

  const cookies = await loadDecryptedCookiesForCreator(creator.creatorId);
  if (!cookies) {
    return {
      ok: false,
      reason: "no_connection",
      message: "Skool credentials missing or invalid. Reconnect in Settings.",
    };
  }

  try {
    const summary = await syncCommunity({
      communityId: community.id,
      skoolGroupId: community.skoolGroupId,
      cookies,
      trigger: "manual",
    });

    revalidatePath("/drop-off");
    revalidatePath("/today");

    if (summary.status === "failed") {
      return {
        ok: false,
        reason: "error",
        message: summary.errorMessage ?? "Sync failed.",
      };
    }

    const parts: string[] = [];
    if (summary.coursesUpserted) {
      parts.push(`${summary.coursesUpserted} ${plural("course", summary.coursesUpserted)}`);
    }
    if (summary.lessonsUpserted) {
      parts.push(`${summary.lessonsUpserted} ${plural("lesson", summary.lessonsUpserted)}`);
    }
    const detail = parts.length > 0 ? parts.join(", ") : "no changes";

    return {
      ok: true,
      status: summary.status === "running" ? "succeeded" : summary.status,
      message: `Synced ${detail}.`,
    };
  } catch (err) {
    if (err instanceof SyncAlreadyRunningError) {
      return {
        ok: false,
        reason: "running",
        message: "A sync is already in progress for this community.",
      };
    }
    throw err;
  }
}

function plural(word: string, n: number): string {
  return n === 1 ? word : `${word}s`;
}
