import { and, eq, gte, max, sql } from "drizzle-orm";

import { db } from "@/db";
import { courses, lessons, members, memberProgress } from "@/db/schema/communities";
import { memberCheckIns } from "@/db/schema/reports";

import { classifyMemberRisk, type MemberRiskFlag } from "./at-risk";
import { rankCheckIns, DAILY_CHECK_IN_CAP } from "./rank";

// Server-side loader that produces the daily check-in list for a
// community. Computes at-risk on the fly from `members` +
// `member_progress` (cheap — communities are bounded), then ranks
// per the wisdom doc and caps at 7.
//
// Lives outside the page file so /today can reuse it for the "top
// person to DM" widget without duplicating the DB joins.

export interface CheckInRow {
  memberId: string;
  name: string | null;
  email: string | null;
  skoolMemberId: string | null;
  joinedAt: Date | null;
  lastActiveAt: Date | null;
  tier: string | null;
  ltv: number | null;
  completedLessons: number;
  inProgressLessons: number;
  flag: MemberRiskFlag;
  /** Has the creator already copied a draft for this member in the
   *  last 24h? Drives the "Drafted today" pill in the UI. */
  alreadyDraftedToday: boolean;
}

interface LoadOptions {
  communityId: string;
  creatorId: string;
  asOf?: Date;
  cap?: number;
}

export async function loadDailyCheckIns(
  opts: LoadOptions,
): Promise<CheckInRow[]> {
  const asOf = opts.asOf ?? new Date();
  const cap = opts.cap ?? DAILY_CHECK_IN_CAP;

  // Total lesson count — used to skip "they finished everything" cases.
  const [totalLessonsRow] = await db
    .select({ count: sql<number>`count(*)` })
    .from(lessons)
    .innerJoin(courses, eq(courses.id, lessons.courseId))
    .where(eq(courses.communityId, opts.communityId));
  const totalLessons = Number(totalLessonsRow?.count ?? 0);

  // Pull every member with their derived progression aggregates.
  const memberRows = await db
    .select({
      id: members.id,
      name: members.name,
      email: members.email,
      skoolMemberId: members.skoolMemberId,
      joinedAt: members.joinedAt,
      lastActiveAt: members.lastActiveAt,
      tier: members.tier,
      ltv: members.ltv,
    })
    .from(members)
    .where(eq(members.communityId, opts.communityId));

  if (memberRows.length === 0) return [];

  // For each member, count completed + in-progress lessons and the
  // most recent in-progress activity. We do this in one query keyed
  // by memberId so we don't fan out N queries.
  const progressAgg = await db
    .select({
      memberId: memberProgress.memberId,
      completedLessons: sql<number>`sum(case when ${memberProgress.completedAt} is not null then 1 else 0 end)`,
      inProgressLessons: sql<number>`sum(case when ${memberProgress.completedAt} is null and (${memberProgress.completionPct})::numeric > 0 then 1 else 0 end)`,
      inProgressLastActivityAt: max(memberProgress.lastActivityAt).as(
        "in_progress_last_activity_at",
      ),
    })
    .from(memberProgress)
    .innerJoin(members, eq(members.id, memberProgress.memberId))
    .where(eq(members.communityId, opts.communityId))
    .groupBy(memberProgress.memberId);

  const aggByMember = new Map<
    string,
    {
      completedLessons: number;
      inProgressLessons: number;
      inProgressLastActivityAt: Date | null;
    }
  >();
  for (const row of progressAgg) {
    aggByMember.set(row.memberId, {
      completedLessons: Number(row.completedLessons ?? 0),
      inProgressLessons: Number(row.inProgressLessons ?? 0),
      inProgressLastActivityAt: row.inProgressLastActivityAt ?? null,
    });
  }

  // Drafts already copied today, by memberId, so we can show the pill.
  const since = new Date(asOf.getTime() - 24 * 60 * 60 * 1000);
  const recentDrafts = await db
    .select({
      memberId: memberCheckIns.memberId,
    })
    .from(memberCheckIns)
    .where(
      and(
        eq(memberCheckIns.creatorId, opts.creatorId),
        gte(memberCheckIns.suggestedAt, since),
      ),
    );
  const draftedToday = new Set(recentDrafts.map((r) => r.memberId));

  // Classify + collect flagged rows.
  const candidates: CheckInRow[] = [];
  for (const m of memberRows) {
    const agg = aggByMember.get(m.id) ?? {
      completedLessons: 0,
      inProgressLessons: 0,
      inProgressLastActivityAt: null,
    };

    const flag = classifyMemberRisk(
      {
        memberId: m.id,
        name: m.name,
        joinedAt: m.joinedAt,
        lastActiveAt: m.lastActiveAt,
        completedLessons: agg.completedLessons,
        inProgressLessons: agg.inProgressLessons,
        inProgressLastActivityAt: agg.inProgressLastActivityAt,
        totalLessons,
      },
      asOf,
    );

    if (!flag) continue;

    candidates.push({
      memberId: m.id,
      name: m.name,
      email: m.email,
      skoolMemberId: m.skoolMemberId,
      joinedAt: m.joinedAt,
      lastActiveAt: m.lastActiveAt,
      tier: m.tier,
      ltv: m.ltv !== null ? Number(m.ltv) : null,
      completedLessons: agg.completedLessons,
      inProgressLessons: agg.inProgressLessons,
      flag,
      alreadyDraftedToday: draftedToday.has(m.id),
    });
  }

  // Rank. We push already-drafted members down so the creator works
  // through the rest of the list before re-DMing the same person.
  const rankedNotDrafted = rankCheckIns(
    candidates.filter((c) => !c.alreadyDraftedToday),
    cap,
  );
  const rankedDrafted = rankCheckIns(
    candidates.filter((c) => c.alreadyDraftedToday),
    cap,
  );

  return [...rankedNotDrafted, ...rankedDrafted].slice(0, cap);
}

/**
 * `loadDailyCheckIns` is a relatively beefy query — `/today` only
 * needs the top one. Tiny convenience that runs the same thing with
 * cap=1 and returns either the row or null.
 */
export async function loadTopCheckIn(
  opts: Omit<LoadOptions, "cap">,
): Promise<CheckInRow | null> {
  const list = await loadDailyCheckIns({ ...opts, cap: 1 });
  return list[0] ?? null;
}
