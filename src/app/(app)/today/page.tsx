import Link from "next/link";
import { redirect } from "next/navigation";
import { and, asc, eq, isNotNull } from "drizzle-orm";

import { db } from "@/db";
import {
  communityMetricsDaily,
  courses,
  lessons,
  members,
} from "@/db/schema/communities";
import { firstNameFrom } from "@/lib/checkins";
import { loadTopCheckIn, type CheckInRow } from "@/lib/checkins/load";
import { latestValue, trendOverWindow, type DailyPoint } from "@/lib/pulse/aggregate";
import {
  getCurrentCreator,
  getPrimaryCommunity,
  getSkoolConnection,
} from "@/lib/server/creator";

// V2 "Today" view (mockup screen 01-today.png).
//
// Days 8-10 update: combine the day's signals — top check-in, worst
// drop-off lesson, sync freshness — instead of the setup-checklist-
// only placeholder. Setup checklist still appears when the creator
// hasn't synced yet (graceful fallback).
//
// Voice rules from master plan Part 6:
//   - Greeting: "Good [morning/afternoon], Xavier. Here's what's
//     happening today." (NOT "Welcome back. 247 active members.")
//   - Never panicked, never growth-marketing language

export const dynamic = "force-dynamic";

export default async function TodayPage() {
  const creator = await getCurrentCreator();
  if (!creator) redirect("/sign-in");

  const connection = await getSkoolConnection(creator.creatorId);
  const community = await getPrimaryCommunity(creator.creatorId);
  const greeting = greetingForHour(new Date(), creator.timezone);
  const firstName = creator.email.split("@")[0];

  let totals = {
    members: 0,
    membersWithProgressionId: 0,
    courses: 0,
    lessons: 0,
  };
  let topCheckIn: CheckInRow | null = null;
  let worstLesson: WorstLesson | null = null;
  let pulse: PulseSummary | null = null;

  if (community) {
    const [memberRows, withId, courseRows, lessonRows] = await Promise.all([
      db
        .select({ id: members.id })
        .from(members)
        .where(eq(members.communityId, community.id)),
      db
        .select({ id: members.id })
        .from(members)
        .where(
          and(
            eq(members.communityId, community.id),
            isNotNull(members.skoolMemberId),
          ),
        ),
      db
        .select({ id: courses.id })
        .from(courses)
        .where(eq(courses.communityId, community.id)),
      db
        .select({ id: lessons.id })
        .from(lessons)
        .innerJoin(courses, eq(courses.id, lessons.courseId))
        .where(eq(courses.communityId, community.id)),
    ]);
    totals = {
      members: memberRows.length,
      membersWithProgressionId: withId.length,
      courses: courseRows.length,
      lessons: lessonRows.length,
    };

    [topCheckIn, worstLesson, pulse] = await Promise.all([
      loadTopCheckIn({
        communityId: community.id,
        creatorId: creator.creatorId,
      }),
      loadWorstLesson(community.id),
      loadPulseSummary(community.id),
    ]);
  }

  const synced = community?.lastSyncedAt ?? null;
  const hasAnyData = totals.members > 0 || totals.lessons > 0;

  return (
    <div className="max-w-4xl">
      <header className="flex items-start justify-between">
        <div>
          <h1 className="font-display text-5xl leading-tight">
            {greeting},{" "}
            <em className="font-display not-italic">{firstName}</em>.
          </h1>
          <p className="mt-3 text-lg text-muted">
            Here&apos;s what&apos;s happening in your community today.
          </p>
        </div>
        <div className="text-right text-xs text-muted">
          <div>
            <span
              className={`mr-1.5 inline-block h-1.5 w-1.5 rounded-full align-middle ${
                synced ? "bg-forest" : "bg-rule"
              }`}
            />
            {syncLabel(synced)}
          </div>
          <div className="mt-1">
            {new Date().toLocaleDateString("en-US", {
              weekday: "long",
              month: "long",
              day: "numeric",
            })}
          </div>
        </div>
      </header>

      {!connection.connected ? (
        <ConnectFirstCard />
      ) : !hasAnyData ? (
        <SetupContent totals={totals} synced={synced !== null} />
      ) : (
        <>
          <DailySignals
            topCheckIn={topCheckIn}
            worstLesson={worstLesson}
            pulse={pulse}
          />
          {(!totals.membersWithProgressionId || !pulse) && (
            <SetupContent totals={totals} synced={synced !== null} />
          )}
        </>
      )}
    </div>
  );
}

function DailySignals({
  topCheckIn,
  worstLesson,
  pulse,
}: {
  topCheckIn: CheckInRow | null;
  worstLesson: WorstLesson | null;
  pulse: PulseSummary | null;
}) {
  return (
    <>
      <section className="mt-10 grid grid-cols-1 gap-4 md:grid-cols-2">
        <CheckInTile checkIn={topCheckIn} />
        <DropOffTile lesson={worstLesson} />
      </section>
      <section className="mt-4">
        <PulseTile pulse={pulse} />
      </section>
    </>
  );
}

function CheckInTile({ checkIn }: { checkIn: CheckInRow | null }) {
  if (!checkIn) {
    return (
      <Link
        href="/check-ins"
        className="rounded-card border border-rule bg-canvas p-6 transition hover:border-terracotta/40"
      >
        <div className="text-xs uppercase tracking-[0.18em] text-muted">
          One person to DM
        </div>
        <p className="mt-3 text-base leading-relaxed text-ink">
          Nobody flagged today. Either everyone&apos;s active or the next sync
          will surface someone — open Member Check-ins to see when the
          list refreshes.
        </p>
      </Link>
    );
  }
  const display = checkIn.name?.trim() || checkIn.email || "A member";
  const first = firstNameFrom(checkIn.name) ?? display;
  return (
    <Link
      href="/check-ins"
      className="rounded-card border border-rule bg-cream p-6 transition hover:border-terracotta/40"
    >
      <div className="text-xs uppercase tracking-[0.18em] text-terracotta-ink">
        One person to DM
      </div>
      <div className="mt-2 font-display text-3xl">{first}</div>
      <p className="mt-2 text-sm leading-relaxed text-ink">
        {checkIn.flag.reason}.
      </p>
      <div className="mt-3 text-xs text-muted">
        Open Member Check-ins to draft →
      </div>
    </Link>
  );
}

function DropOffTile({ lesson }: { lesson: WorstLesson | null }) {
  if (!lesson) {
    return (
      <Link
        href="/drop-off"
        className="rounded-card border border-rule bg-canvas p-6 transition hover:border-terracotta/40"
      >
        <div className="text-xs uppercase tracking-[0.18em] text-muted">
          One lesson to fix
        </div>
        <p className="mt-3 text-base leading-relaxed text-ink">
          We don&apos;t have completion data for any lesson yet. The first
          progression sync needs members with Skool IDs — see Settings.
        </p>
      </Link>
    );
  }
  return (
    <Link
      href={`/drop-off/lessons/${lesson.id}`}
      className="rounded-card border border-rule bg-canvas p-6 transition hover:border-terracotta/40"
    >
      <div className="text-xs uppercase tracking-[0.18em] text-muted">
        One lesson to fix
      </div>
      <div className="mt-2 font-display text-3xl">
        L{lesson.position}: {lesson.title}
      </div>
      <p className="mt-2 text-sm leading-relaxed text-ink">
        Only {Math.round(lesson.completionPct)}% of members finish this lesson
        in <em className="not-italic font-medium">{lesson.courseTitle}</em>.
      </p>
      <div className="mt-3 text-xs text-muted">
        Open the zoom view to see why →
      </div>
    </Link>
  );
}

function PulseTile({ pulse }: { pulse: PulseSummary | null }) {
  if (!pulse) {
    return (
      <Link
        href="/pulse"
        className="block rounded-card border border-dashed border-rule bg-canvas/60 p-5 transition hover:border-terracotta/40"
      >
        <div className="text-xs uppercase tracking-[0.18em] text-muted">
          This week&apos;s pulse
        </div>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          Activity time-series fills in after the first metrics sync.
        </p>
      </Link>
    );
  }
  const direction =
    pulse.regularsTrend === "up"
      ? "up"
      : pulse.regularsTrend === "down"
        ? "down"
        : "flat";
  return (
    <Link
      href="/pulse"
      className="block rounded-card border border-rule bg-canvas p-5 transition hover:border-terracotta/40"
    >
      <div className="flex items-baseline justify-between">
        <div className="text-xs uppercase tracking-[0.18em] text-muted">
          This week&apos;s pulse
        </div>
        <div className="text-xs text-muted/70">Open Pulse →</div>
      </div>
      <p className="mt-2 text-sm leading-relaxed text-ink">
        <span className="font-medium">{pulse.regularsThisWeek ?? "—"}</span>{" "}
        regulars this week —{" "}
        {direction === "up"
          ? "trending up vs last week."
          : direction === "down"
            ? "down vs last week. Worth a check-in post."
            : "flat vs last week."}
      </p>
    </Link>
  );
}

function SetupContent({
  totals,
  synced,
}: {
  totals: {
    members: number;
    membersWithProgressionId: number;
    courses: number;
    lessons: number;
  };
  synced: boolean;
}) {
  return (
    <>
      <section className="mt-10 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat label="Members" value={totals.members} />
        <Stat
          label="With progression ID"
          value={totals.membersWithProgressionId}
          hint={
            totals.members > 0 && totals.membersWithProgressionId === 0
              ? "Add IDs via CSV"
              : undefined
          }
        />
        <Stat label="Courses" value={totals.courses} />
        <Stat label="Lessons" value={totals.lessons} />
      </section>

      <NextStepsCard totals={totals} synced={synced} />
    </>
  );
}

function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: number;
  hint?: string;
}) {
  return (
    <div className="rounded-card border border-rule bg-canvas px-4 py-4">
      <div className="text-xs uppercase tracking-[0.18em] text-muted">{label}</div>
      <div className="mt-1 font-display text-3xl">{value}</div>
      {hint ? <div className="mt-1 text-xs text-muted">{hint}</div> : null}
    </div>
  );
}

function NextStepsCard({
  totals,
  synced,
}: {
  totals: {
    members: number;
    membersWithProgressionId: number;
    courses: number;
    lessons: number;
  };
  synced: boolean;
}) {
  const steps: Array<{ done: boolean; label: React.ReactNode }> = [
    { done: synced, label: <>First data sync</> },
    {
      done: totals.courses > 0 && totals.lessons > 0,
      label: <>Course + lesson structure mapped</>,
    },
    {
      done: totals.members > 0,
      label: (
        <>
          Members imported (
          <Link href="/settings" className="underline-offset-4 hover:underline">
            Settings
          </Link>
          )
        </>
      ),
    },
    {
      done: totals.membersWithProgressionId > 0,
      label: <>At least one member has a Skool ID for progression sync</>,
    },
  ];

  const allDone = steps.every((s) => s.done);

  return (
    <section className="mt-8 rounded-card border border-rule bg-cream p-6">
      <div className="text-xs uppercase tracking-[0.18em] text-terracotta-ink">
        {allDone ? "Setup complete" : "Setup in progress"}
      </div>
      <p className="mt-3 max-w-2xl text-sm leading-relaxed text-ink">
        {allDone ? (
          <>
            You&apos;re ready. Pulse and Member Check-ins are pulling from
            real progression data now.
          </>
        ) : (
          <>
            Member Check-ins and Pulse use real progression data. Each step
            below pulls another piece of it.
          </>
        )}
      </p>
      <ul className="mt-4 space-y-2 text-sm">
        {steps.map((step, i) => (
          <li key={i} className="flex items-start gap-2">
            <span
              aria-hidden
              className={`mt-1 inline-block h-3 w-3 rounded-full ${
                step.done ? "bg-forest" : "border border-rule bg-canvas"
              }`}
            />
            <span className={step.done ? "text-ink" : "text-muted"}>
              {step.label}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function syncLabel(synced: Date | null): string {
  if (!synced) return "Not synced yet";
  const diffMs = Date.now() - synced.getTime();
  const minutes = Math.round(diffMs / 60_000);
  if (minutes < 1) return "Synced just now";
  if (minutes < 60) return `Synced ${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `Synced ${hours}h ago`;
  const days = Math.round(hours / 24);
  return `Synced ${days}d ago`;
}

function ConnectFirstCard() {
  return (
    <section className="mt-10 rounded-card border border-rule bg-cream p-6">
      <div className="text-xs uppercase tracking-[0.18em] text-terracotta-ink">
        Welcome
      </div>
      <p className="mt-3 max-w-xl text-base leading-relaxed text-ink">
        We&apos;ll show your community&apos;s pulse here once you connect Skool.
        It takes about 60 seconds: you paste two cookies from your logged-in
        Skool tab into Settings, and we start syncing.
      </p>
      <div className="mt-5 flex items-center gap-3">
        <a
          href="/settings"
          className="rounded-lg bg-ink px-4 py-2 text-sm text-canvas hover:bg-ink/90"
        >
          Connect Skool
        </a>
      </div>
    </section>
  );
}

function greetingForHour(now: Date, timezone: string): string {
  const hour = Number.parseInt(
    now.toLocaleString("en-US", { hour: "2-digit", hour12: false, timeZone: timezone }),
    10,
  );
  if (Number.isNaN(hour) || hour < 5) return "Good evening";
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

interface WorstLesson {
  id: string;
  title: string;
  position: number;
  completionPct: number;
  courseTitle: string;
}

async function loadWorstLesson(communityId: string): Promise<WorstLesson | null> {
  const rows = await db
    .select({
      id: lessons.id,
      title: lessons.title,
      position: lessons.positionInCourse,
      completionPct: lessons.completionPct,
      courseTitle: courses.title,
    })
    .from(lessons)
    .innerJoin(courses, eq(courses.id, lessons.courseId))
    .where(
      and(
        eq(courses.communityId, communityId),
        isNotNull(lessons.completionPct),
      ),
    )
    .orderBy(asc(lessons.completionPct));
  const top = rows[0];
  if (!top || top.completionPct === null) return null;
  return {
    id: top.id,
    title: top.title,
    position: top.position,
    completionPct: Number(top.completionPct),
    courseTitle: top.courseTitle,
  };
}

interface PulseSummary {
  regularsThisWeek: number | null;
  regularsTrend: "up" | "down" | "flat" | null;
}

async function loadPulseSummary(
  communityId: string,
): Promise<PulseSummary | null> {
  const rows = await db
    .select({
      metricDate: communityMetricsDaily.metricDate,
      totalMembers: communityMetricsDaily.totalMembers,
      activeMembers: communityMetricsDaily.activeMembers,
      dailyActivities: communityMetricsDaily.dailyActivities,
    })
    .from(communityMetricsDaily)
    .where(eq(communityMetricsDaily.communityId, communityId));
  if (rows.length === 0) return null;
  const points: DailyPoint[] = rows.map((r) => ({
    date: r.metricDate,
    totalMembers: r.totalMembers,
    activeMembers: r.activeMembers,
    dailyActivities: r.dailyActivities,
  }));
  const regulars = latestValue(points, "activeMembers");
  const trend = trendOverWindow(points, "activeMembers", 7);
  return {
    regularsThisWeek: regulars,
    regularsTrend: trend ? trend.trend : null,
  };
}
