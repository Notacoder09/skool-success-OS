"use server";

import { revalidatePath } from "next/cache";
import { and, eq, gte } from "drizzle-orm";

import { db } from "@/db";
import { members } from "@/db/schema/communities";
import { memberCheckIns } from "@/db/schema/reports";
import type { DraftTone } from "@/lib/checkins";
import { TONES } from "@/lib/checkins";
import { getCurrentCreator, getPrimaryCommunity } from "@/lib/server/creator";

// Day 8-10 — server action for /check-ins. Records that the creator
// drafted a DM for a given member with a given tone, so the UI can
// show "drafted today" and the daily list can deprioritise members
// the creator has already addressed.
//
// We keep the storage shape narrow on purpose: a row is a
// *creator interaction*, not a derived at-risk score. The score is
// computed from `members` + `member_progress` at render time (cheap),
// and survives migrations / threshold tweaks without backfill.

export type RecordDraftResult =
  | { ok: true; status: "recorded" }
  | {
      ok: false;
      reason: "no_creator" | "no_community" | "not_found" | "bad_tone";
      message: string;
    };

const RECENT_DRAFT_WINDOW_MS = 24 * 60 * 60 * 1000; // 24h dedupe window

export async function recordCheckInDraft(args: {
  memberId: string;
  tone: DraftTone;
  draftedMessage: string;
}): Promise<RecordDraftResult> {
  if (!TONES.includes(args.tone)) {
    return {
      ok: false,
      reason: "bad_tone",
      message: "Unknown tone.",
    };
  }

  const creator = await getCurrentCreator();
  if (!creator) {
    return {
      ok: false,
      reason: "no_creator",
      message: "Sign in again.",
    };
  }

  const community = await getPrimaryCommunity(creator.creatorId);
  if (!community) {
    return {
      ok: false,
      reason: "no_community",
      message: "Connect Skool in Settings first.",
    };
  }

  // Verify the member belongs to this creator's community.
  const [memberRow] = await db
    .select({ id: members.id })
    .from(members)
    .where(
      and(eq(members.id, args.memberId), eq(members.communityId, community.id)),
    );

  if (!memberRow) {
    return {
      ok: false,
      reason: "not_found",
      message: "Member not found in your community.",
    };
  }

  // Dedupe within the last 24h: a creator can draft + redraft within
  // a few seconds (changing tones), but we don't want 50 rows per day.
  const since = new Date(Date.now() - RECENT_DRAFT_WINDOW_MS);
  const [existing] = await db
    .select({ id: memberCheckIns.id })
    .from(memberCheckIns)
    .where(
      and(
        eq(memberCheckIns.creatorId, creator.creatorId),
        eq(memberCheckIns.memberId, args.memberId),
        gte(memberCheckIns.suggestedAt, since),
      ),
    )
    .limit(1);

  if (existing) {
    await db
      .update(memberCheckIns)
      .set({
        status: "copied",
        draftMessages: { [args.tone]: args.draftedMessage },
        lastTouchedAt: new Date(),
      })
      .where(eq(memberCheckIns.id, existing.id));
  } else {
    await db.insert(memberCheckIns).values({
      creatorId: creator.creatorId,
      memberId: args.memberId,
      reason: "manual_draft", // we don't re-store the at-risk reason
      // here because it can shift; the page recomputes it on render.
      draftMessages: { [args.tone]: args.draftedMessage },
      status: "copied",
      lastTouchedAt: new Date(),
    });
  }

  revalidatePath("/check-ins");
  revalidatePath("/today");

  return { ok: true, status: "recorded" };
}
