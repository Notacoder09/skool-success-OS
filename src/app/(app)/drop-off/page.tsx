import Link from "next/link";
import { redirect } from "next/navigation";
import { and, asc, desc, eq, inArray, isNotNull } from "drizzle-orm";

import { db } from "@/db";
import { courses, lessons, members } from "@/db/schema/communities";
import { syncRuns } from "@/db/schema/sync";
import { toneForCompletion } from "@/lib/sync";
import {
  getCurrentCreator,
  getPrimaryCommunity,
  getSkoolConnection,
} from "@/lib/server/creator";

import { RefreshNowButton } from "./RefreshNowButton";

// Drop-Off Map (Feature 1, master plan §"Days 4-7"). Day 4 shipped the
// page shell + course/lesson structure. Day 5 fills cells with real
// completion %, computes "main leak" per course, and shows progression
// state honestly.
//
// Mockup reference: docs/mockups/02-drop-off-map.png. Voice + thresholds:
// docs/creator-wisdom-and-product-decisions.md.

export const dynamic = "force-dynamic";

interface LessonRow {
  id: string;
  courseId: string;
  title: string;
  position: number;
  completionPct: string | null;
}

export default async function DropOffPage() {
  const creator = await getCurrentCreator();
  if (!creator) redirect("/sign-in");

  const [community, connection] = await Promise.all([
    getPrimaryCommunity(creator.creatorId),
    getSkoolConnection(creator.creatorId),
  ]);

  if (!connection.connected || !community) {
    return <NotConnectedState />;
  }

  const courseRows = await db
    .select({
      id: courses.id,
      skoolCourseId: courses.skoolCourseId,
      title: courses.title,
      isPrimary: courses.isPrimary,
      enrolledCount: courses.enrolledCount,
      completedCount: courses.completedCount,
      lastSyncedAt: courses.lastSyncedAt,
      createdAt: courses.createdAt,
    })
    .from(courses)
    .where(eq(courses.communityId, community.id))
    .orderBy(asc(courses.createdAt));

  const lessonRows: LessonRow[] =
    courseRows.length > 0
      ? await db
          .select({
            id: lessons.id,
            courseId: lessons.courseId,
            title: lessons.title,
            position: lessons.positionInCourse,
            completionPct: lessons.completionPct,
          })
          .from(lessons)
          .where(
            inArray(
              lessons.courseId,
              courseRows.map((c) => c.id),
            ),
          )
          .orderBy(asc(lessons.courseId), asc(lessons.positionInCourse))
      : [];

  const [lastRun] = await db
    .select({
      status: syncRuns.status,
      startedAt: syncRuns.startedAt,
      finishedAt: syncRuns.finishedAt,
      errorMessage: syncRuns.errorMessage,
      membersUpserted: syncRuns.membersUpserted,
      progressUpserted: syncRuns.progressUpserted,
    })
    .from(syncRuns)
    .where(eq(syncRuns.communityId, community.id))
    .orderBy(desc(syncRuns.startedAt))
    .limit(1);

  const memberStats = await db
    .select({ id: members.id })
    .from(members)
    .where(eq(members.communityId, community.id));
  const memberCount = memberStats.length;

  const memberIdStats = await db
    .select({ id: members.id })
    .from(members)
    .where(
      and(
        eq(members.communityId, community.id),
        isNotNull(members.skoolMemberId),
      ),
    );
  const membersWithProgressionId = memberIdStats.length;

  const lessonsByCourse = new Map<string, LessonRow[]>();
  for (const l of lessonRows) {
    const arr = lessonsByCourse.get(l.courseId) ?? [];
    arr.push(l);
    lessonsByCourse.set(l.courseId, arr);
  }

  const hasAnyProgression = lessonRows.some((l) => l.completionPct !== null);
  const totalLessons = lessonRows.length;

  return (
    <div className="max-w-5xl">
      <header className="flex items-start justify-between gap-6">
        <div>
          <h1 className="font-display text-5xl leading-tight">
            Drop-Off <em className="font-display">Map</em>
          </h1>
          <p className="mt-3 text-base text-muted">
            See where members lose momentum in your courses.
          </p>
        </div>
        <div className="flex flex-col items-end gap-3">
          <div className="text-right text-xs text-muted">
            <div>
              {courseRows.length} {plural("course", courseRows.length)} ·{" "}
              {totalLessons} {plural("lesson", totalLessons)} ·{" "}
              {memberCount} {plural("member", memberCount)}
            </div>
            <div className="mt-1">{lastRunLabel(lastRun)}</div>
          </div>
          <RefreshNowButton />
        </div>
      </header>

      {courseRows.length === 0 ? (
        <FirstSyncCard lastRun={lastRun} />
      ) : (
        <>
          <DataStateBanner
            memberCount={memberCount}
            membersWithProgressionId={membersWithProgressionId}
            hasAnyProgression={hasAnyProgression}
            lastRun={lastRun}
            lessonRows={lessonRows}
          />
          <CoursesSection courseRows={courseRows} lessonsByCourse={lessonsByCourse} />
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// States
// ---------------------------------------------------------------------------

function NotConnectedState() {
  return (
    <div className="max-w-2xl">
      <h1 className="font-display text-5xl">Drop-Off <em className="font-display">Map</em>.</h1>
      <p className="mt-3 text-base text-muted">
        See where members lose momentum in your courses.
      </p>
      <section className="mt-10 rounded-card border border-rule bg-cream p-6">
        <div className="text-xs uppercase tracking-[0.18em] text-terracotta-ink">
          Connect first
        </div>
        <p className="mt-3 max-w-xl text-base leading-relaxed text-ink">
          We&apos;ll map your courses and lessons here once you connect Skool.
          Takes about a minute.
        </p>
        <Link
          href="/settings"
          className="mt-5 inline-block rounded-lg bg-ink px-4 py-2 text-sm text-canvas hover:bg-ink/90"
        >
          Connect Skool
        </Link>
      </section>
    </div>
  );
}

function FirstSyncCard({
  lastRun,
}: {
  lastRun:
    | {
        status: string;
        startedAt: Date;
        errorMessage: string | null;
      }
    | undefined;
}) {
  const failed = lastRun?.status === "failed";
  return (
    <section className="mt-10 rounded-card border border-rule bg-cream p-6">
      <div className="text-xs uppercase tracking-[0.18em] text-terracotta-ink">
        {failed ? "Last sync failed" : "First sync"}
      </div>
      <p className="mt-3 max-w-xl text-base leading-relaxed text-ink">
        {failed ? (
          <>
            Skool returned an error on the last attempt:{" "}
            <span className="font-mono text-sm text-terracotta-ink">
              {lastRun?.errorMessage ?? "unknown error"}
            </span>
            . Try again — and if it keeps happening, reconnect from Settings.
          </>
        ) : (
          <>
            We haven&apos;t pulled your course structure yet. Click{" "}
            <strong>Refresh now</strong> in the top right to pull it — usually
            takes a few seconds for a small community.
          </>
        )}
      </p>
    </section>
  );
}

// State-aware banner that replaces the static "Coming Day 5" card.
// Tells the creator exactly what's missing and how to unblock.
function DataStateBanner({
  memberCount,
  membersWithProgressionId,
  hasAnyProgression,
  lastRun,
  lessonRows,
}: {
  memberCount: number;
  membersWithProgressionId: number;
  hasAnyProgression: boolean;
  lastRun: { status: string } | undefined;
  lessonRows: LessonRow[];
}) {
  // 1. No members at all → push to CSV import.
  if (memberCount === 0) {
    return (
      <BannerCard tone="warn" kicker="Cells stay empty until we have members">
        Skool deliberately hides your member list — even from owners (master
        plan Part 4). To populate completion percentages, upload a member
        export from Skool in{" "}
        <Link href="/settings" className="text-ink underline-offset-4 hover:underline">
          Settings → Members
        </Link>
        . If your CSV includes member IDs, the next sync run will pull
        everyone&apos;s progression automatically.
      </BannerCard>
    );
  }

  // 2. Have members, but none with Skool IDs (CSV-only, no IDs) →
  //    explain the gap, point at harvest results from the next sync.
  if (membersWithProgressionId === 0) {
    return (
      <BannerCard tone="warn" kicker="Members are imported, but no Skool IDs yet">
        We have {memberCount} {plural("member", memberCount)} from your CSV but
        no Skool member IDs to call the per-member progression endpoint with.
        Re-export with a <span className="font-mono">Member ID</span> column,
        or wait — the next background sync also tries to harvest IDs from
        your analytics endpoints.
      </BannerCard>
    );
  }

  // 3. Have members + IDs but progression hasn't been computed yet →
  //    nudge to refresh.
  if (!hasAnyProgression) {
    return (
      <BannerCard tone="warn" kicker="Ready to compute completion %">
        {membersWithProgressionId} of {memberCount}{" "}
        {plural("member", memberCount)} have Skool IDs we can sync progression
        for. Click <strong>Refresh now</strong> to pull their completion data.
        {lastRun?.status === "partial" ? (
          <>
            {" "}
            (Last sync had warnings — check the run record if it keeps happening.)
          </>
        ) : null}
      </BannerCard>
    );
  }

  // 4. Real data — pick the worst lesson across all courses and call it
  //    the main leak. AI-generated insight prose lands Day 6 (master plan).
  const ranked = [...lessonRows]
    .filter((l): l is LessonRow & { completionPct: string } => l.completionPct !== null)
    .map((l) => ({ ...l, pct: Number(l.completionPct) }))
    .sort((a, b) => a.pct - b.pct);
  const worst = ranked[0];

  return (
    <BannerCard tone="ok" kicker="Where momentum dies">
      {worst ? (
        <>
          The biggest leak right now is{" "}
          <strong>L{worst.position}: {worst.title}</strong> at{" "}
          <strong>{Math.round(worst.pct)}%</strong> completion across{" "}
          {memberCount} {plural("member", memberCount)}. AI-generated insight
          prose (why it&apos;s leaking, what to try) ships Day 6 — for now,
          this is the lesson worth opening in Skool.
        </>
      ) : (
        <>Progression is synced. Cells below show real per-lesson completion %.</>
      )}
    </BannerCard>
  );
}

type BannerTone = "ok" | "warn";

function BannerCard({
  tone,
  kicker,
  children,
}: {
  tone: BannerTone;
  kicker: string;
  children: React.ReactNode;
}) {
  const stripe = tone === "warn" ? "border-l-terracotta" : "border-l-forest";
  const kickerColor =
    tone === "warn" ? "text-terracotta-ink" : "text-forest";
  return (
    <section
      className={`mt-8 rounded-card border-l-4 ${stripe} border-y border-r border-rule bg-cream p-6`}
    >
      <div
        className={`text-xs uppercase tracking-[0.18em] ${kickerColor}`}
      >
        {kicker}
      </div>
      <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink">
        {children}
      </p>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Course grid
// ---------------------------------------------------------------------------

function CoursesSection({
  courseRows,
  lessonsByCourse,
}: {
  courseRows: Array<{
    id: string;
    title: string;
    isPrimary: boolean;
    enrolledCount: number | null;
    completedCount: number | null;
  }>;
  lessonsByCourse: Map<string, LessonRow[]>;
}) {
  return (
    <section className="mt-10">
      <div className="flex items-baseline justify-between">
        <h2 className="font-display text-2xl">All courses</h2>
        <div className="text-xs text-muted">
          <span className="mr-2 inline-block h-2 w-2 rounded-full bg-forest align-middle" />
          Healthy ≥75%
          <span className="mx-3 text-rule">·</span>
          <span className="mr-2 inline-block h-2 w-2 rounded-full bg-terracotta-soft align-middle" />
          Slipping 50–74%
          <span className="mx-3 text-rule">·</span>
          <span className="mr-2 inline-block h-2 w-2 rounded-full bg-terracotta align-middle" />
          Leaking &lt;50%
        </div>
      </div>

      <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-2">
        {courseRows.map((course) => (
          <CourseCard
            key={course.id}
            course={course}
            lessons={lessonsByCourse.get(course.id) ?? []}
          />
        ))}
        <FutureCourseSlot existingCount={courseRows.length} />
      </div>
    </section>
  );
}

function CourseCard({
  course,
  lessons: lessonRows,
}: {
  course: {
    id: string;
    title: string;
    isPrimary: boolean;
    enrolledCount: number | null;
    completedCount: number | null;
  };
  lessons: LessonRow[];
}) {
  // "Main leak" = lowest-completion lesson in this course. Falls back
  // to "pending" until any lesson has progression data.
  const ranked = lessonRows
    .filter((l): l is LessonRow & { completionPct: string } => l.completionPct !== null)
    .map((l) => ({ ...l, pct: Number(l.completionPct) }))
    .sort((a, b) => a.pct - b.pct);
  const worst = ranked[0];

  return (
    <article className="rounded-card border border-rule bg-canvas p-5">
      <header className="flex items-start justify-between">
        <div>
          <h3 className="font-display text-xl">{course.title}</h3>
          <p className="mt-0.5 text-xs text-muted">
            {lessonRows.length} {plural("lesson", lessonRows.length)}
            {course.isPrimary ? " · Primary course" : ""}
          </p>
        </div>
        <span className="text-xs text-muted">
          {/* Click-to-zoom lands Day 6 (master plan). */}
          Zoom view coming Day 6
        </span>
      </header>

      {lessonRows.length === 0 ? (
        <p className="mt-4 text-sm text-muted">
          No lessons synced for this course yet.
        </p>
      ) : (
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {lessonRows.map((l) => (
            <LessonCell
              key={l.id}
              position={l.position}
              title={l.title}
              completionPct={l.completionPct}
            />
          ))}
        </div>
      )}

      <footer className="mt-4 flex items-center justify-between text-xs text-muted">
        <span>
          {course.enrolledCount !== null
            ? `${course.enrolledCount} enrolled · ${course.completedCount ?? 0} completed`
            : "Enrollment data pending"}
        </span>
        <span className="text-muted/70">
          {worst
            ? `Main leak: L${worst.position} (${Math.round(worst.pct)}%)`
            : "Main leak: pending"}
        </span>
      </footer>
    </article>
  );
}

function LessonCell({
  position,
  title,
  completionPct,
}: {
  position: number;
  title: string;
  completionPct: string | null;
}) {
  const pct = completionPct ? Number(completionPct) : null;
  const tone = toneForCompletion(pct);
  const cls = {
    unknown: "border-rule bg-canvas text-muted",
    healthy: "border-forest/40 bg-forest-soft text-ink",
    warm: "border-terracotta-soft bg-terracotta-soft/40 text-ink",
    leak: "border-terracotta/40 bg-terracotta-soft/70 text-terracotta-ink",
  }[tone];

  return (
    <div className={`flex flex-col gap-1 rounded-md border px-3 py-3 ${cls}`}>
      <div className="text-[10px] uppercase tracking-wider text-muted">L{position}</div>
      <div className="line-clamp-2 min-h-[2.5rem] text-xs font-medium leading-snug">
        {title}
      </div>
      <div className="text-base font-display">
        {pct === null ? "—" : `${Math.round(pct)}%`}
      </div>
    </div>
  );
}

function FutureCourseSlot({ existingCount }: { existingCount: number }) {
  return (
    <article className="rounded-card border border-dashed border-rule bg-canvas/50 p-5 text-muted">
      <h3 className="font-display text-xl">Future course slot</h3>
      <p className="mt-1 text-xs text-muted">
        {existingCount === 0
          ? "Each course you add in Skool gets its own drop-off map automatically."
          : "When you add more courses in Skool, they appear here automatically."}
      </p>
    </article>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function plural(word: string, n: number): string {
  return n === 1 ? word : `${word}s`;
}

function lastRunLabel(
  run:
    | { status: string; startedAt: Date; finishedAt: Date | null }
    | undefined,
): string {
  if (!run) return "Never synced";
  const ts = run.finishedAt ?? run.startedAt;
  const diffMs = Date.now() - ts.getTime();
  const minutes = Math.round(diffMs / 60_000);
  if (minutes < 1) return "Synced just now";
  if (minutes < 60) return `Synced ${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `Synced ${hours}h ago`;
  const days = Math.round(hours / 24);
  return `Synced ${days}d ago`;
}
