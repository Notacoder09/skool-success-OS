import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { and, asc, desc, eq, inArray, isNotNull } from "drizzle-orm";

import { ConnectFirstCard } from "@/components/ConnectFirstCard";
import { db } from "@/db";
import { courses, lessons, members } from "@/db/schema/communities";
import { syncRuns } from "@/db/schema/sync";
import { findLargestCliff, formatCliff, toneForCompletion } from "@/lib/sync";
import {
  getCurrentCreator,
  getPrimaryCommunity,
  getSkoolConnection,
} from "@/lib/server/creator";
import { getOrGenerateLessonInsight, INSIGHT_FALLBACK_MODEL } from "@/lib/ai";

import { RefreshNowButton } from "./RefreshNowButton";
import { renderInsightProse } from "./insight-prose";

// Drop-Off Map (Feature 1, master plan §"Days 4-7"). Day 4 shipped the
// page shell + course/lesson structure. Day 5 wired real completion %
// and "main leak" per course. Day 6 (this) replaces the static banner
// with AI-grounded "What we're seeing" prose and links every lesson
// cell to a zoom view.
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
    return (
      <div className="max-w-5xl">
        <DropOffPageHeader />
        <div className="mt-8">
          <ConnectFirstCard feature="your Drop-Off Map" />
        </div>
      </div>
    );
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
              {totalLessons} {plural("lesson", totalLessons)}
            </div>
            <div className="mt-1">Click any lesson to zoom in</div>
            <div className="mt-1 text-muted/70">{lastRunLabel(lastRun)}</div>
          </div>
          <RefreshNowButton />
        </div>
      </header>

      {courseRows.length === 0 ? (
        <FirstSyncCard lastRun={lastRun} />
      ) : (
        <>
          {/*
            Day 7 — wrap the banner in <Suspense> so the rest of the
            page (the course grid, which is the V1 hero feature) paints
            immediately. The banner itself can take 1–3s when Anthropic
            is on, and there's no point blocking on it; the loading
            shell uses the same kicker so the layout doesn't jump.
          */}
          <Suspense fallback={<BannerLoading />}>
            <DataStateBanner
              memberCount={memberCount}
              membersWithProgressionId={membersWithProgressionId}
              hasAnyProgression={hasAnyProgression}
              lastRun={lastRun}
              lessonRows={lessonRows}
              courseRows={courseRows}
            />
          </Suspense>
          <CoursesSection courseRows={courseRows} lessonsByCourse={lessonsByCourse} />
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// States
// ---------------------------------------------------------------------------

function DropOffPageHeader() {
  return (
    <header>
      <h1 className="font-display text-5xl leading-tight">
        Drop-Off <em className="font-display">Map</em>
      </h1>
      <p className="mt-3 text-base text-muted">
        See where members lose momentum in your courses.
      </p>
    </header>
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
async function DataStateBanner({
  memberCount,
  membersWithProgressionId,
  hasAnyProgression,
  lastRun,
  lessonRows,
  courseRows,
}: {
  memberCount: number;
  membersWithProgressionId: number;
  hasAnyProgression: boolean;
  lastRun: { status: string } | undefined;
  lessonRows: LessonRow[];
  courseRows: Array<{ id: string; title: string }>;
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

  // 4. Real data → AI-grounded "What we're seeing" insight (Day 6).
  //    We pick the worst lesson across all courses, hand it + its
  //    neighbours to the insight generator, and cache the prose under
  //    that lesson ID so the zoom view reuses the same row.
  const ranked = [...lessonRows]
    .filter((l): l is LessonRow & { completionPct: string } => l.completionPct !== null)
    .map((l) => ({ ...l, pct: Number(l.completionPct) }))
    .sort((a, b) => a.pct - b.pct);
  const worst = ranked[0];

  if (!worst) {
    return (
      <BannerCard tone="ok" kicker="What we're seeing">
        Progression is synced. Cells below show real per-lesson completion %.
      </BannerCard>
    );
  }

  // Find neighbours within the same course for the magnitude language.
  const sameCourseLessons = lessonRows
    .filter((l) => l.courseId === worst.courseId)
    .sort((a, b) => a.position - b.position);
  const idxInCourse = sameCourseLessons.findIndex((l) => l.id === worst.id);
  const prev = idxInCourse > 0 ? sameCourseLessons[idxInCourse - 1] : null;
  const next =
    idxInCourse >= 0 && idxInCourse < sameCourseLessons.length - 1
      ? sameCourseLessons[idxInCourse + 1]
      : null;
  const courseTitle =
    courseRows.find((c) => c.id === worst.courseId)?.title ?? "this course";

  const insight = await getOrGenerateLessonInsight(worst.id, {
    courseTitle,
    courseLessonCount: sameCourseLessons.length,
    memberCount,
    worstPosition: worst.position,
    worstTitle: worst.title,
    worstCompletionPct: worst.pct,
    previousPosition: prev?.position ?? null,
    previousTitle: prev?.title ?? null,
    previousCompletionPct: prev?.completionPct !== undefined && prev?.completionPct !== null
      ? Number(prev.completionPct)
      : null,
    nextPosition: next?.position ?? null,
    nextTitle: next?.title ?? null,
    nextCompletionPct: next?.completionPct !== undefined && next?.completionPct !== null
      ? Number(next.completionPct)
      : null,
  });

  const isFallback = insight.model === INSIGHT_FALLBACK_MODEL;

  return (
    <BannerCard tone="warn" kicker="What we're seeing">
      <span className="block">{renderInsightProse(insight.body)}</span>
      <span className="mt-3 flex flex-wrap items-center gap-3 text-xs text-muted">
        <Link
          href={`/drop-off/lessons/${worst.id}`}
          className="rounded-lg bg-ink px-3 py-1.5 text-xs text-canvas hover:bg-ink/90"
        >
          Zoom into Lesson {worst.position}
        </Link>
        {isFallback ? (
          <span className="text-muted/80">
            Voice upgrade: add{" "}
            <span className="font-mono text-[11px]">ANTHROPIC_API_KEY</span> in
            your env to get fully AI-written prose. The reasoning above is the
            same; the wording gets richer.
          </span>
        ) : (
          <span className="text-muted/80">
            Generated {minutesAgo(insight.generatedAt)} ago · refreshes daily
          </span>
        )}
      </span>
    </BannerCard>
  );
}

// Same outer shell as BannerCard so layout doesn't jump when the
// real banner replaces it. Tone defaults to "warn" (terracotta
// stripe) because that's what the AI banner usually resolves to;
// if it ends up being "ok" the small flicker is acceptable.
function BannerLoading() {
  return (
    <section className="mt-8 rounded-card border-l-4 border-l-terracotta border-y border-r border-rule bg-cream p-6">
      <div className="text-xs uppercase tracking-[0.18em] text-terracotta-ink">
        What we&apos;re seeing
      </div>
      <div className="mt-3 max-w-2xl space-y-2 text-sm leading-relaxed text-ink/30">
        <div className="h-3 w-full animate-pulse rounded bg-rule/40" />
        <div className="h-3 w-11/12 animate-pulse rounded bg-rule/40" />
        <div className="h-3 w-9/12 animate-pulse rounded bg-rule/40" />
      </div>
      <div className="mt-3 text-[11px] text-muted/70">
        Reading lesson-by-lesson completion…
      </div>
    </section>
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
      <div className="mt-2 max-w-2xl text-sm leading-relaxed text-ink">
        {children}
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
  // Day 7: "Main leak" is now cliff-aware — the lesson-to-lesson
  // transition with the biggest drop, preferring transitions that
  // cross into the leak zone (<50%). Matches the V2 mockup phrasing
  // "Main leak: L2 → L3 (66% → 33%)".
  //
  // Falls back to lowest-completion lesson when there's only one
  // lesson with data (no transition to compute). Falls back to
  // "pending" when no lesson has progression yet.
  const cliffLessons = lessonRows.map((l) => ({
    id: l.id,
    position: l.position,
    title: l.title,
    completionPct: l.completionPct !== null ? Number(l.completionPct) : null,
  }));
  const cliff = findLargestCliff(cliffLessons);
  const cliffLabel = formatCliff(cliff);

  const lowestLesson = cliffLabel
    ? null
    : cliffLessons
        .filter((l): l is typeof l & { completionPct: number } => l.completionPct !== null)
        .sort((a, b) => a.completionPct - b.completionPct)[0] ?? null;

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
        <span className="text-xs text-muted">Click any lesson to zoom →</span>
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
              id={l.id}
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
          {cliffLabel
            ? `Main leak: ${cliffLabel}`
            : lowestLesson
            ? `Main leak: L${lowestLesson.position} (${Math.round(lowestLesson.completionPct)}%)`
            : "Main leak: pending"}
        </span>
      </footer>
    </article>
  );
}

function LessonCell({
  id,
  position,
  title,
  completionPct,
}: {
  id: string;
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
    <Link
      href={`/drop-off/lessons/${id}`}
      aria-label={`Zoom into Lesson ${position}: ${title}`}
      className={`flex flex-col gap-1 rounded-md border px-3 py-3 transition hover:-translate-y-0.5 hover:shadow-card focus:outline-none focus-visible:ring-2 focus-visible:ring-terracotta/50 ${cls}`}
    >
      <div className="text-[10px] uppercase tracking-wider text-muted">L{position}</div>
      <div className="line-clamp-2 min-h-[2.5rem] text-xs font-medium leading-snug">
        {title}
      </div>
      <div className="text-base font-display">
        {pct === null ? "—" : `${Math.round(pct)}%`}
      </div>
    </Link>
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

function minutesAgo(ts: Date): string {
  const diffMs = Date.now() - ts.getTime();
  const minutes = Math.round(diffMs / 60_000);
  if (minutes < 1) return "moments";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  return `${days}d`;
}
