import Link from "next/link";
import { and, eq, isNotNull } from "drizzle-orm";

import { db } from "@/db";
import { courses, lessons, members } from "@/db/schema/communities";
import {
  getCurrentCreator,
  getPrimaryCommunity,
  getSkoolConnection,
} from "@/lib/server/creator";

// V2 "Today" view (mockup screen 1). Day 5 ships the honest framing
// while Pulse + Check-ins build out (master plan Days 8-10).
//
// Operating Principle #5 — never fake numbers. Until at-risk scoring
// lands, the only metrics we surface are ones we can actually compute
// from real synced data: member count, mapped courses/lessons, sync
// freshness.

export default async function TodayPage() {
  const creator = await getCurrentCreator();
  if (!creator) return null;

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
  }

  const synced = community?.lastSyncedAt ?? null;

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
      ) : (
        <TodayContent totals={totals} synced={synced !== null} />
      )}
    </div>
  );
}

function TodayContent({
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
            You&apos;re ready. Pulse and Member Check-ins land Days 8-10 of the
            build sequence — your data is being collected in the background
            until then.
          </>
        ) : (
          <>
            The Pulse and Member Check-ins features (Days 8-10) need real
            data to be useful. Each step below pulls another piece of it.
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
  // Use the creator's stored timezone so the greeting matches their day.
  const hour = Number.parseInt(
    now.toLocaleString("en-US", { hour: "2-digit", hour12: false, timeZone: timezone }),
    10,
  );
  if (Number.isNaN(hour) || hour < 5) return "Good evening";
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}
