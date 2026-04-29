"use server";

import { revalidatePath } from "next/cache";

import { buildAndSendWeeklyReport } from "@/lib/weekly-report/orchestrator";
import { getCurrentCreator } from "@/lib/server/creator";

// Server actions for /weekly-report. The "Regenerate now" button is
// the only mutation surface — everything else is read-only.

export type RegenerateNowResult =
  | {
      ok: true;
      reportId: string;
      variant: "weekly" | "welcome";
      sent: boolean;
      reusedExisting: boolean;
      sectionCount: number;
    }
  | { ok: false; error: string };

/**
 * Force a build of *this week's* report regardless of the Monday-7am
 * window. Used when the creator wants to preview / refresh mid-week.
 *
 * Idempotent: the orchestrator upserts on (creator_id, week_start_date),
 * so repeated clicks compose the latest copy without sending again.
 * Sends are gated on `reusedExisting === false` — once this week's
 * report has been emailed, subsequent regenerates only refresh the
 * stored markdown body for the viewer page.
 */
export async function regenerateWeeklyReportNow(): Promise<RegenerateNowResult> {
  const creator = await getCurrentCreator();
  if (!creator) return { ok: false, error: "not_authenticated" };

  try {
    const outcome = await buildAndSendWeeklyReport({
      creatorId: creator.creatorId,
      ignoreSchedule: true,
    });
    if (!outcome.ok) {
      const reason = outcome.reason;
      if (reason === "no_community") {
        return {
          ok: false,
          error: "Connect your Skool community in Settings first.",
        };
      }
      if (reason === "creator_no_email") {
        return {
          ok: false,
          error: "We couldn't find your account email — contact support.",
        };
      }
      return { ok: false, error: reason };
    }
    revalidatePath("/weekly-report");
    return {
      ok: true,
      reportId: outcome.reportId,
      variant: outcome.variant,
      sent: outcome.emailMessageId !== null,
      reusedExisting: outcome.reusedExisting,
      sectionCount: outcome.sectionCount,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown_error";
    return { ok: false, error: message };
  }
}
