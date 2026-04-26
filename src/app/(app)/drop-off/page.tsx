import Link from "next/link";
import { redirect } from "next/navigation";
import { asc, desc, eq, inArray } from "drizzle-orm";

import { db } from "@/db";
import { courses, lessons } from "@/db/schema/communities";
import { syncRuns } from "@/db/schema/sync";
import {
  getCurrentCreator,
  getPrimaryCommunity,
  getSkoolConnection,
} from "@/lib/server/creator";

import { RefreshNowButton } from "./RefreshNowButton";

// Drop-Off Map (Feature 1, master plan §"Days 4-7"). Day 4 ships the
// page shell + course/lesson structure pulled by the sync layer.
// Per-lesson completion percentages and AI insights land Days 5-7
// once member discovery + progression aggregation are wired.
//
// Mockup reference: docs/mockups/02-drop-off-map.png. Voice + thresholds:
// docs/creator-wisdom-and-product-decisions.md.

export const dynamic = "force-dynamic";

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

  const lessonRows =
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
    })
    .from(syncRuns)
    .where(eq(syncRuns.communityId, community.id))
    .orderBy(desc(syncRuns.startedAt))
    .limit(1);

  const lessonsByCourse = new Map<string, typeof lessonRows>();
  for (const l of lessonRows) {
    const arr = lessonsByCourse.get(l.courseId) ?? [];
    arr.push(l);
    lessonsByCourse.set(l.courseId, arr);
  }

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
              {totalLessons} {plural("lesson", totalLessons)}
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
          <ProgressionPendingCard />
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
  lastRun: {
    status: string;
    startedAt: Date;
    errorMessage: string | null;
  } | undefined;
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

function ProgressionPendingCard() {
  // Honest stand-in for the AI insight card from the mockup. Day 5
  // wires per-member progression and the AI insight; until then we
  // refuse to display made-up percentages or a fake insight.
  return (
    <section className="mt-8 rounded-card border-l-4 border-terracotta border-y border-r border-rule bg-cream p-6">
      <div className="flex items-start gap-3">
        <span aria-hidden className="text-xl text-terracotta-ink">!</span>
        <div>
          <div className="text-xs uppercase tracking-[0.18em] text-terracotta-ink">
            Coming Day 5
          </div>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink">
            Your course structure is mapped — lesson cells light up with real
            completion percentages once we wire member progression sync. The
            AI insight panel here will explain where momentum dies, grounded
            in your actual data (not generic SaaS speak).
          </p>
        </div>
      </div>
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
  lessonsByCourse: Map<
    string,
    Array<{
      id: string;
      title: string;
      position: number;
      completionPct: string | null;
    }>
  >;
}) {
  return (
    <section className="mt-10">
      <div className="flex items-baseline justify-between">
        <h2 className="font-display text-2xl">All courses</h2>
        <div className="text-xs text-muted">
          <span className="mr-2 inline-block h-2 w-2 rounded-full bg-forest align-middle" />
          Green = healthy
          <span className="mx-3 text-rule">·</span>
          <span className="mr-2 inline-block h-2 w-2 rounded-full bg-terracotta align-middle" />
          Orange = losing people
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
  lessons: Array<{
    id: string;
    title: string;
    position: number;
    completionPct: string | null;
  }>;
}) {
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
          {/* Click-to-zoom lands Day 6 (master plan). For now the link
              is non-actionable so we don't promise UI we don't have. */}
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
          {/* Real numbers go here Day 5+ once progression is wired. */}
          {course.enrolledCount !== null
            ? `${course.enrolledCount} enrolled · ${course.completedCount ?? 0} completed`
            : "Enrollment data pending"}
        </span>
        <span className="text-muted/70">Main leak: pending</span>
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
  // Without progression data we render a neutral cell rather than a
  // green/orange one — colour signals nothing if the value is unknown.
  // Day 5 fills completionPct and we switch to the V2 colour scale.
  const pct = completionPct ? Number(completionPct) : null;
  const tone =
    pct === null
      ? "neutral"
      : pct >= 75
        ? "healthy"
        : pct >= 50
          ? "warm"
          : "leak";
  const cls = {
    neutral: "border-rule bg-canvas text-muted",
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
  run: { status: string; startedAt: Date; finishedAt: Date | null } | undefined,
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
