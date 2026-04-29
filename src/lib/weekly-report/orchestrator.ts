import "server-only";

import { and, asc, eq, gte, isNotNull, lt, sql } from "drizzle-orm";

import { db } from "@/db";
import {
  communities,
  communityMetricsDaily,
  courses,
  lessons,
  memberProgress,
  members,
} from "@/db/schema/communities";
import { users } from "@/db/schema/auth";
import { creators } from "@/db/schema/creators";
import { weeklyReports } from "@/db/schema/reports";
import { firstNameFrom } from "@/lib/checkins";
import { loadTopCheckIn } from "@/lib/checkins/load";
import { sendEmail } from "@/lib/email";
import {
  activityByDayOfWeek,
  latestValue,
  trendOverWindow,
  type DailyPoint,
} from "@/lib/pulse/aggregate";

import { buildReportEmail, type ReportEmailOutput } from "./email";
import {
  buildAllSections,
  type FullReportInput,
  type ReportSection,
} from "./sections";
import {
  evaluateMondaySchedule,
  weekStartDateForTz,
} from "./schedule";
import {
  DAY_90_MILESTONE,
  FIRST_WEEK_WELCOME_DAYS,
  RETENTION_PLATFORM_AVG,
} from "./thresholds";

// Days 11-13 — Weekly Optimization Report orchestrator.
//
// Plain English: this is the function that ties everything together.
// Pull the signals (top check-in, worst lesson, pulse), pick a
// variant (welcome vs weekly), compose the sections, store the
// markdown body in `weekly_reports`, and post the HTML to Resend.
//
// Idempotency lives at three layers:
//   1. weekly_reports unique idx on (creator_id, week_start_date) — the
//      same week never produces two rows.
//   2. We bail early if `sentAt` is already set on the existing row.
//   3. Resend `Idempotency-Key` header dedupes within 24h on a (creator,
//      week_start_date) tuple in case we're racing two crons.
//
// Pure-function helpers in sections.ts/email.ts/thresholds.ts/schedule.ts
// stay outside this file. Anything that hits the DB lives here.

const REPORT_TAG_VARIANT_WEEKLY = "weekly";
const REPORT_TAG_VARIANT_WELCOME = "welcome";

const DAY_MS = 24 * 60 * 60 * 1000;

export interface BuildOpts {
  creatorId: string;
  /** Used for tests + manual regenerate; defaults to now. */
  now?: Date;
  /**
   * When true we don't actually call Resend or persist `sentAt`;
   * everything else (row insert, body composition) still runs so the
   * UI's "preview" path can render.
   */
  dryRun?: boolean;
  /**
   * Skip the Monday-7am schedule check. Used by the manual
   * "regenerate now" button so a creator can preview the current week
   * mid-week. The cron route never sets this.
   */
  ignoreSchedule?: boolean;
}

export interface BuildResult {
  ok: true;
  reportId: string;
  weekStartDate: Date;
  variant: "weekly" | "welcome";
  emailedTo: string | null;
  emailMessageId: string | null;
  sectionCount: number;
  reusedExisting: boolean;
  scheduleFired: boolean;
  bodyMd: string;
}

export interface BuildSkip {
  ok: false;
  reason:
    | "creator_not_found"
    | "no_community"
    | "schedule_not_due"
    | "creator_no_email";
}

export type BuildOutcome = BuildResult | BuildSkip;

export async function buildAndSendWeeklyReport(
  opts: BuildOpts,
): Promise<BuildOutcome> {
  const now = opts.now ?? new Date();

  const [creator] = await db
    .select({
      id: creators.id,
      timezone: creators.timezone,
      createdAt: creators.createdAt,
    })
    .from(creators)
    .where(eq(creators.id, opts.creatorId));
  if (!creator) return { ok: false, reason: "creator_not_found" };

  const [community] = await db
    .select({ id: communities.id })
    .from(communities)
    .where(eq(communities.creatorId, creator.id))
    .limit(1);
  if (!community) return { ok: false, reason: "no_community" };

  const schedule = evaluateMondaySchedule(now, creator.timezone);
  const scheduleFired = schedule.shouldFire;
  if (!scheduleFired && !opts.ignoreSchedule) {
    return { ok: false, reason: "schedule_not_due" };
  }
  // For "regenerate now" outside Monday 7am we still want a stable
  // weekStartDate so the row is idempotent — use the creator's local
  // current week.
  const weekStartDate = opts.ignoreSchedule
    ? weekStartDateForTz(now, creator.timezone)
    : schedule.weekStartDate;

  const recipientEmail = await loadCreatorRecipientEmail(creator.id);
  if (!recipientEmail && !opts.dryRun) {
    return { ok: false, reason: "creator_no_email" };
  }
  const firstName = firstNameFrom(deriveCreatorDisplayName(recipientEmail));

  const daysOnPlatform = Math.max(
    0,
    Math.floor((now.getTime() - creator.createdAt.getTime()) / DAY_MS),
  );
  const isFirstWeek = daysOnPlatform < FIRST_WEEK_WELCOME_DAYS;

  const signals = await collectSignals({
    creatorId: creator.id,
    communityId: community.id,
    now,
  });

  const reportInput: FullReportInput = {
    celebrate: {
      day90Crossing: signals.day90Crossing,
      topLesson: null,
      regularsThisWeek: signals.regularsThisWeek,
    },
    checkIn: { topMember: signals.topMember },
    lessonToFix: { worstLesson: signals.worstLesson },
    pattern: {
      retentionRate: signals.retentionRate,
      regularsTrend: signals.regularsTrend,
      bestDayOfWeek: signals.bestDayOfWeek,
    },
    question: {
      firstName,
      retentionBelowAvg:
        signals.retentionRate !== null &&
        signals.retentionRate < RETENTION_PLATFORM_AVG,
    },
    isFirstWeek,
    daysOnPlatform,
  };

  const sections: ReportSection[] = buildAllSections(reportInput);
  const variant: "weekly" | "welcome" = isFirstWeek ? "welcome" : "weekly";
  const weekLabel = formatWeekLabel(weekStartDate);

  const email: ReportEmailOutput = buildReportEmail({
    firstName,
    sections,
    weekLabel,
    variant,
  });

  // Upsert the row first so we always have an audit record, even if
  // Resend later fails.
  const upserted = await db
    .insert(weeklyReports)
    .values({
      creatorId: creator.id,
      weekStartDate,
      variant,
      bodyMd: email.markdown,
    })
    .onConflictDoUpdate({
      target: [weeklyReports.creatorId, weeklyReports.weekStartDate],
      set: {
        variant,
        bodyMd: email.markdown,
      },
    })
    .returning({
      id: weeklyReports.id,
      sentAt: weeklyReports.sentAt,
    });
  const row = upserted[0];
  if (!row) {
    throw new Error("weekly_reports upsert returned no row");
  }
  const reusedExisting = row.sentAt !== null;

  let emailMessageId: string | null = null;
  let emailedTo: string | null = null;

  const shouldSend = !opts.dryRun && !reusedExisting && Boolean(recipientEmail);
  if (shouldSend && recipientEmail) {
    const sent = await sendEmail({
      to: recipientEmail,
      subject: email.subject,
      html: email.html,
      text: email.text,
      idempotencyKey: `weekly-report:${creator.id}:${formatIsoDate(weekStartDate)}`,
      tags: [
        { name: "feature", value: "weekly_report" },
        {
          name: "variant",
          value:
            variant === "welcome"
              ? REPORT_TAG_VARIANT_WELCOME
              : REPORT_TAG_VARIANT_WEEKLY,
        },
      ],
    });
    emailMessageId = sent.id;
    emailedTo = recipientEmail;

    await db
      .update(weeklyReports)
      .set({ sentAt: now, resendMessageId: sent.id })
      .where(eq(weeklyReports.id, row.id));
    // Note: we don't catch here. Letting it propagate keeps the cron's
    // per-creator try/catch as the single retry surface, and the
    // unique idx + Resend idem key prevent duplicates on re-run.
  }

  return {
    ok: true,
    reportId: row.id,
    weekStartDate,
    variant,
    emailedTo,
    emailMessageId,
    sectionCount: sections.length,
    reusedExisting,
    scheduleFired,
    bodyMd: email.markdown,
  };
}

interface SignalBundle {
  topMember: { name: string; reason: string } | null;
  worstLesson: {
    title: string;
    positionInCourse: number;
    completionPct: number;
  } | null;
  retentionRate: number | null;
  regularsTrend: "up" | "down" | "flat" | null;
  regularsThisWeek: number | null;
  bestDayOfWeek: string | null;
  day90Crossing: { name: string; days: number } | null;
}

async function collectSignals(opts: {
  creatorId: string;
  communityId: string;
  now: Date;
}): Promise<SignalBundle> {
  const [topCheckIn, worstLessonRow, metricsRows, day90, completionAgg] =
    await Promise.all([
      loadTopCheckIn({
        communityId: opts.communityId,
        creatorId: opts.creatorId,
        asOf: opts.now,
      }),
      loadWorstLesson(opts.communityId),
      loadMetricsRows(opts.communityId),
      loadDay90Crossing(opts.communityId, opts.now),
      loadRetentionRate(opts.communityId, opts.now),
    ]);

  const points: DailyPoint[] = metricsRows.map((r) => ({
    date: r.metricDate,
    totalMembers: r.totalMembers,
    activeMembers: r.activeMembers,
    dailyActivities: r.dailyActivities,
  }));

  const regularsTrendDelta = trendOverWindow(points, "activeMembers", 7);
  const regularsThisWeek = latestValue(points, "activeMembers");
  const bestDayOfWeek = pickBestDayOfWeek(points);

  const topMember =
    topCheckIn && topCheckIn.name
      ? { name: topCheckIn.name, reason: topCheckIn.flag.reason }
      : null;

  return {
    topMember,
    worstLesson: worstLessonRow,
    retentionRate: completionAgg,
    regularsTrend: regularsTrendDelta?.trend ?? null,
    regularsThisWeek,
    bestDayOfWeek,
    day90Crossing: day90,
  };
}

async function loadCreatorRecipientEmail(
  creatorId: string,
): Promise<string | null> {
  const rows = await db
    .select({ email: users.email })
    .from(creators)
    .innerJoin(users, eq(users.id, creators.userId))
    .where(eq(creators.id, creatorId))
    .limit(1);
  return rows[0]?.email ?? null;
}

function deriveCreatorDisplayName(email: string | null): string | null {
  if (!email) return null;
  const local = email.split("@")[0] ?? "";
  if (!local) return null;
  // Replace separators with spaces so firstNameFrom can split it. We
  // capitalise the first letter so "xavier" becomes "Xavier" when
  // surfaced in the email greeting.
  const cleaned = local.replace(/[._-]+/g, " ").trim();
  if (!cleaned) return null;
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

async function loadWorstLesson(communityId: string): Promise<
  SignalBundle["worstLesson"]
> {
  const rows = await db
    .select({
      title: lessons.title,
      positionInCourse: lessons.positionInCourse,
      completionPct: lessons.completionPct,
    })
    .from(lessons)
    .innerJoin(courses, eq(courses.id, lessons.courseId))
    .where(
      and(
        eq(courses.communityId, communityId),
        isNotNull(lessons.completionPct),
      ),
    )
    .orderBy(asc(lessons.completionPct))
    .limit(1);
  const top = rows[0];
  if (!top || top.completionPct === null) return null;
  return {
    title: top.title,
    positionInCourse: top.positionInCourse,
    completionPct: Number(top.completionPct),
  };
}

async function loadMetricsRows(communityId: string) {
  return db
    .select({
      metricDate: communityMetricsDaily.metricDate,
      totalMembers: communityMetricsDaily.totalMembers,
      activeMembers: communityMetricsDaily.activeMembers,
      dailyActivities: communityMetricsDaily.dailyActivities,
    })
    .from(communityMetricsDaily)
    .where(eq(communityMetricsDaily.communityId, communityId));
}

async function loadDay90Crossing(
  communityId: string,
  now: Date,
): Promise<{ name: string; days: number } | null> {
  // Members whose joinedAt is between (now - 97d) and (now - 90d):
  // they crossed day 90 inside the last 7 days. We surface the longest-
  // tenured one in that range so the celebration isn't always the
  // freshest crossing — long-tenured members are stronger anchors.
  const upper = new Date(now.getTime() - DAY_90_MILESTONE * DAY_MS);
  const lower = new Date(upper.getTime() - 7 * DAY_MS);
  const rows = await db
    .select({
      name: members.name,
      joinedAt: members.joinedAt,
    })
    .from(members)
    .where(
      and(
        eq(members.communityId, communityId),
        isNotNull(members.joinedAt),
        gte(members.joinedAt, lower),
        lt(members.joinedAt, upper),
      ),
    )
    .orderBy(asc(members.joinedAt))
    .limit(1);
  const row = rows[0];
  if (!row || !row.joinedAt || !row.name) return null;
  const days = Math.floor((now.getTime() - row.joinedAt.getTime()) / DAY_MS);
  return { name: row.name, days };
}

async function loadRetentionRate(
  communityId: string,
  now: Date,
): Promise<number | null> {
  // Pragmatic proxy: members active in the last 30 days / total
  // members. The wisdom-doc retention thresholds (good ≥ 0.9, avg
  // 0.8, bad < 0.7) all describe a 30-day-active rate at 90+ days,
  // so this is the closest deterministic signal we have without a
  // long history of activity snapshots.
  const since = new Date(now.getTime() - 30 * DAY_MS);
  const [totals] = await db
    .select({
      total: sql<number>`count(*)`,
      active: sql<number>`sum(case when ${members.lastActiveAt} >= ${since} then 1 else 0 end)`,
    })
    .from(members)
    .where(eq(members.communityId, communityId));
  if (!totals) return null;
  const total = Number(totals.total ?? 0);
  if (total === 0) return null;
  // Don't grade a community before it has a meaningful denominator.
  if (total < 5) return null;
  const active = Number(totals.active ?? 0);
  return active / total;
}

const DAY_LABELS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

function pickBestDayOfWeek(points: DailyPoint[]): string | null {
  if (points.length === 0) return null;
  const sums = activityByDayOfWeek(points);
  let bestIdx = -1;
  let bestVal = -Infinity;
  for (let i = 0; i < sums.length; i += 1) {
    const v = sums[i] ?? 0;
    if (v > bestVal) {
      bestVal = v;
      bestIdx = i;
    }
  }
  if (bestIdx < 0 || bestVal <= 0) return null;
  return DAY_LABELS[bestIdx] ?? null;
}

function formatWeekLabel(weekStartDate: Date): string {
  const month = weekStartDate.toLocaleDateString("en-US", {
    month: "short",
    timeZone: "UTC",
  });
  const day = weekStartDate.toLocaleDateString("en-US", {
    day: "numeric",
    timeZone: "UTC",
  });
  const year = weekStartDate.toLocaleDateString("en-US", {
    year: "numeric",
    timeZone: "UTC",
  });
  return `Week of ${month} ${day}, ${year}`;
}

function formatIsoDate(d: Date): string {
  const yyyy = d.getUTCFullYear().toString().padStart(4, "0");
  const mm = (d.getUTCMonth() + 1).toString().padStart(2, "0");
  const dd = d.getUTCDate().toString().padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

// Re-exports for convenience so consumers only need to import the
// orchestrator module by name.
export { evaluateMondaySchedule, weekStartDateForTz };
// memberProgress is reserved for a future avg-completion retention
// metric (currently unused; see retention rate proxy comment above).
void memberProgress;
