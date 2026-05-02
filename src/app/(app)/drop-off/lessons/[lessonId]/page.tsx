import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { and, asc, eq, inArray } from "drizzle-orm";

import { db } from "@/db";
import {
  courses,
  lessons,
  memberProgress,
  members,
} from "@/db/schema/communities";
import {
  getCurrentCreator,
  getPrimaryCommunity,
  getSkoolConnection,
} from "@/lib/server/creator";
import {
  buildSuggestedActions,
  getOrGenerateLessonInsight,
  INSIGHT_FALLBACK_MODEL,
  type InsightInput,
  type SuggestedAction,
} from "@/lib/ai";
import { toneForCompletion } from "@/lib/sync";

import { renderInsightProse } from "../../insight-prose";
import { RegenerateInsightButton } from "./RegenerateInsightButton";

// Day 6 — click-to-zoom lesson detail (Feature 1, master plan §"Days
// 4-7"). Reached from a lesson cell on /drop-off. Shows the AI insight
// prose, a 3-cell strip with the previous/this/next completion, and a
// member-level breakdown so the creator can see who is stuck where.
//
// Mockup reference: docs/mockups/02-drop-off-map.png — the V2 mockup
// describes click-to-zoom. We render it as a dedicated route rather
// than an inline panel so the URL is shareable (good for the weekly
// report's "one lesson to fix" link, Feature 5).

export const dynamic = "force-dynamic";

interface PageProps {
  params: { lessonId: string };
}

export default async function LessonZoomPage({ params }: PageProps) {
  const creator = await getCurrentCreator();
  if (!creator) redirect("/sign-in");

  const community = await getPrimaryCommunity(creator.creatorId);
  const connection = await getSkoolConnection(creator.creatorId);
  if (!community || !connection.connected) {
    redirect("/drop-off");
  }

  // Resolve lesson + verify it belongs to this creator's community.
  // The join through courses is the ownership check.
  const [lessonRow] = await db
    .select({
      id: lessons.id,
      title: lessons.title,
      position: lessons.positionInCourse,
      completionPct: lessons.completionPct,
      lastSyncedAt: lessons.lastSyncedAt,
      courseId: lessons.courseId,
      courseTitle: courses.title,
      videoUrl: lessons.videoUrl,
      description: lessons.description,
      descriptionWordCount: lessons.descriptionWordCount,
    })
    .from(lessons)
    .innerJoin(courses, eq(courses.id, lessons.courseId))
    .where(and(eq(lessons.id, params.lessonId), eq(courses.communityId, community.id)));

  if (!lessonRow) notFound();

  // Sibling lessons for the prev/next strip and prompt context.
  const courseLessons = await db
    .select({
      id: lessons.id,
      title: lessons.title,
      position: lessons.positionInCourse,
      completionPct: lessons.completionPct,
    })
    .from(lessons)
    .where(eq(lessons.courseId, lessonRow.courseId))
    .orderBy(asc(lessons.positionInCourse));

  const idx = courseLessons.findIndex((l) => l.id === lessonRow.id);
  const prev = idx > 0 ? courseLessons[idx - 1] ?? null : null;
  const next =
    idx >= 0 && idx < courseLessons.length - 1
      ? courseLessons[idx + 1] ?? null
      : null;

  // Members in this community + their progress on this lesson.
  const memberRows = await db
    .select({
      id: members.id,
      name: members.name,
      handle: members.handle,
      email: members.email,
      lastActiveAt: members.lastActiveAt,
    })
    .from(members)
    .where(eq(members.communityId, community.id))
    .orderBy(asc(members.name));

  const progressRows =
    memberRows.length > 0
      ? await db
          .select({
            memberId: memberProgress.memberId,
            completionPct: memberProgress.completionPct,
            completedAt: memberProgress.completedAt,
            lastActivityAt: memberProgress.lastActivityAt,
          })
          .from(memberProgress)
          .where(
            and(
              eq(memberProgress.lessonId, lessonRow.id),
              inArray(
                memberProgress.memberId,
                memberRows.map((m) => m.id),
              ),
            ),
          )
      : [];

  const progressByMemberId = new Map(
    progressRows.map((p) => [p.memberId, p]),
  );

  const memberRecords = memberRows.map((m) => {
    const p = progressByMemberId.get(m.id);
    const pct = p?.completionPct !== undefined && p?.completionPct !== null ? Number(p.completionPct) : null;
    const completedAt = p?.completedAt ?? null;
    const lastActivityAt = p?.lastActivityAt ?? null;
    return {
      ...m,
      progressPct: pct,
      completedAt,
      lastActivityAt,
      state: classify(pct, completedAt, lastActivityAt),
    };
  });

  // Sort: who-needs-help first (incomplete + active recently), then
  // not-started, then completed at the bottom.
  memberRecords.sort((a, b) => {
    const order = (s: MemberState) =>
      ({ incomplete: 0, not_started: 1, completed: 2 } as const)[s];
    if (order(a.state) !== order(b.state)) return order(a.state) - order(b.state);
    return (a.name ?? "").localeCompare(b.name ?? "");
  });

  const completedCount = memberRecords.filter((m) => m.state === "completed").length;
  const incompleteCount = memberRecords.filter((m) => m.state === "incomplete").length;
  const notStartedCount = memberRecords.filter((m) => m.state === "not_started").length;

  const completionPct = lessonRow.completionPct !== null ? Number(lessonRow.completionPct) : null;
  const tone = toneForCompletion(completionPct);

  const insightInput: InsightInput = {
    courseTitle: lessonRow.courseTitle,
    courseLessonCount: courseLessons.length,
    memberCount: memberRecords.length,
    worstPosition: lessonRow.position,
    worstTitle: lessonRow.title,
    worstCompletionPct: completionPct ?? 0,
    previousPosition: prev?.position ?? null,
    previousTitle: prev?.title ?? null,
    previousCompletionPct:
      prev?.completionPct !== undefined && prev?.completionPct !== null
        ? Number(prev.completionPct)
        : null,
    nextPosition: next?.position ?? null,
    nextTitle: next?.title ?? null,
    nextCompletionPct:
      next?.completionPct !== undefined && next?.completionPct !== null
        ? Number(next.completionPct)
        : null,
  };

  // Insight is only meaningful once we have completion data. If we
  // don't, surface a clear empty state instead of generating prose
  // about a "0%" leak that's actually "no data yet".
  const insight =
    completionPct !== null
      ? await getOrGenerateLessonInsight(lessonRow.id, insightInput)
      : null;

  // Day 7 — deterministic "suggested next actions" derived from the
  // wisdom-doc rules. We compute these locally from the lesson +
  // neighbour data we already have on hand. No DB or LLM call.
  const suggestedActions = buildSuggestedActions({
    lessonPosition: lessonRow.position,
    courseLessonCount: courseLessons.length,
    lessonCompletionPct: completionPct,
    previousCompletionPct:
      prev?.completionPct !== undefined && prev?.completionPct !== null
        ? Number(prev.completionPct)
        : null,
    memberCount: memberRecords.length,
  });

  return (
    <div className="max-w-4xl">
      <nav className="text-xs text-muted">
        <Link href="/drop-off" className="hover:text-ink">
          ← Drop-Off Map
        </Link>
        <span className="mx-2 text-rule">/</span>
        <span>{lessonRow.courseTitle}</span>
      </nav>

      <header className="mt-4 flex items-start justify-between gap-6">
        <div>
          <p className="text-xs uppercase tracking-[0.18em] text-muted">
            Lesson {lessonRow.position} of {courseLessons.length}
          </p>
          <h1 className="mt-2 font-display text-4xl leading-tight">
            {lessonRow.title}
          </h1>
          <p className="mt-2 text-sm text-muted">
            in <em className="font-display">{lessonRow.courseTitle}</em>
            {lessonRow.lastSyncedAt
              ? ` · synced ${minutesAgo(lessonRow.lastSyncedAt)} ago`
              : ""}
          </p>
        </div>
        <CompletionBadge pct={completionPct} tone={tone} />
      </header>

      {insight ? (
        <section className="mt-8 rounded-card border-l-4 border-l-terracotta border-y border-r border-rule bg-cream p-6">
          <div className="text-xs uppercase tracking-[0.18em] text-terracotta-ink">
            What we&apos;re seeing
          </div>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink">
            {renderInsightProse(insight.body)}
          </p>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <div className="text-xs text-muted">
              {insight.model === INSIGHT_FALLBACK_MODEL ? (
                <>
                  Rule-based fallback. Add{" "}
                  <span className="font-mono text-[11px]">ANTHROPIC_API_KEY</span>{" "}
                  to your env for fully AI-written prose.
                </>
              ) : (
                <>
                  {insight.fromCache ? "Cached" : "Just generated"} ·{" "}
                  {minutesAgo(insight.generatedAt)} ago · auto-refreshes daily
                </>
              )}
            </div>
            <RegenerateInsightButton lessonId={lessonRow.id} />
          </div>
        </section>
      ) : (
        <section className="mt-8 rounded-card border border-rule bg-canvas p-6">
          <div className="text-xs uppercase tracking-[0.18em] text-muted">
            No completion data yet
          </div>
          <p className="mt-2 max-w-xl text-sm text-ink">
            We&apos;ll generate a drop-off insight as soon as at least one
            member&apos;s progression has been synced. Open the{" "}
            <Link href="/drop-off" className="underline-offset-4 hover:underline">
              Drop-Off Map
            </Link>{" "}
            and click <strong>Refresh now</strong>.
          </p>
        </section>
      )}

      {suggestedActions.length > 0 ? (
        <SuggestedActions actions={suggestedActions} />
      ) : null}

      <NeighbourStrip prev={prev} current={lessonRow} next={next} />

      <section className="mt-12">
        <div className="flex items-baseline justify-between">
          <h2 className="font-display text-2xl">Who&apos;s where</h2>
          <div className="text-xs text-muted">
            {completedCount} done · {incompleteCount} in progress ·{" "}
            {notStartedCount} not started
          </div>
        </div>

        {memberRecords.length === 0 ? (
          <p className="mt-4 text-sm text-muted">
            No members imported yet. Upload a CSV in{" "}
            <Link href="/settings" className="underline-offset-4 hover:underline">
              Settings
            </Link>
            .
          </p>
        ) : (
          <div className="mt-4 overflow-hidden rounded-card border border-rule">
            <table className="w-full text-sm">
              <thead className="bg-cream/50 text-left text-xs uppercase tracking-wider text-muted">
                <tr>
                  <th className="px-4 py-3 font-medium">Member</th>
                  <th className="px-4 py-3 font-medium">Status on this lesson</th>
                  <th className="px-4 py-3 font-medium">Last activity</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-rule bg-canvas">
                {memberRecords.map((m) => (
                  <MemberRow key={m.id} record={m} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="mt-10 rounded-card border border-dashed border-rule bg-canvas/50 p-5 text-sm text-muted">
        <p className="font-medium text-ink">What we don&apos;t know</p>
        <p className="mt-1">
          We can see <em>where</em> members stop. We can&apos;t see <em>why</em>.
          Skool doesn&apos;t expose video heatmaps or scroll depth, so a
          half-finished lesson and a closed tab look the same to us. The fastest
          way to find out is to DM one of the members above (Member Check-ins
          drafts the message for you, lands Days 8–10).
        </p>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Bits
// ---------------------------------------------------------------------------

function SuggestedActions({ actions }: { actions: SuggestedAction[] }) {
  return (
    <section className="mt-8 rounded-card border border-rule bg-canvas p-6">
      <div className="flex items-baseline justify-between">
        <h2 className="font-display text-xl">Try this week</h2>
        <span className="text-[11px] text-muted">
          {actions.length} {actions.length === 1 ? "action" : "actions"} ·
          one a week is the limit
        </span>
      </div>
      <ol className="mt-4 space-y-4">
        {actions.map((a, idx) => (
          <li
            key={a.id}
            className="flex gap-4 border-t border-rule pt-4 first:border-t-0 first:pt-0"
          >
            <div className="font-display text-3xl text-terracotta">
              {idx + 1}
            </div>
            <div className="flex-1">
              <div className="text-sm font-medium text-ink">{a.title}</div>
              <p className="mt-1 text-sm leading-relaxed text-muted">
                {a.body}
              </p>
              <p className="mt-2 text-[11px] text-muted/70">
                <span className="uppercase tracking-wider">Why:</span> {a.reason}
              </p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

function CompletionBadge({
  pct,
  tone,
}: {
  pct: number | null;
  tone: "unknown" | "healthy" | "warm" | "leak";
}) {
  const cls = {
    unknown: "border-rule bg-canvas text-muted",
    healthy: "border-forest/40 bg-forest-soft text-ink",
    warm: "border-terracotta-soft bg-terracotta-soft/40 text-ink",
    leak: "border-terracotta/40 bg-terracotta-soft/70 text-terracotta-ink",
  }[tone];

  return (
    <div className={`rounded-card border px-5 py-4 text-right ${cls}`}>
      <div className="text-[11px] uppercase tracking-[0.18em] text-muted">
        Completion
      </div>
      <div className="mt-1 font-display text-4xl">
        {pct === null ? "—" : `${Math.round(pct)}%`}
      </div>
      <div className="mt-0.5 text-[11px] text-muted">
        {tone === "leak"
          ? "Worth fixing"
          : tone === "warm"
            ? "Slipping"
            : tone === "healthy"
              ? "Healthy"
              : "Pending data"}
      </div>
    </div>
  );
}

function NeighbourStrip({
  prev,
  current,
  next,
}: {
  prev: { title: string; position: number; completionPct: string | null } | null;
  current: { title: string; position: number; completionPct: string | null };
  next: { title: string; position: number; completionPct: string | null } | null;
}) {
  return (
    <section className="mt-8 grid grid-cols-1 gap-3 sm:grid-cols-3">
      <NeighbourCell
        slot="Previous"
        lesson={prev}
        emphasis={false}
      />
      <NeighbourCell slot="This lesson" lesson={current} emphasis />
      <NeighbourCell slot="Next" lesson={next} emphasis={false} />
    </section>
  );
}

function NeighbourCell({
  slot,
  lesson,
  emphasis,
}: {
  slot: string;
  lesson:
    | { title: string; position: number; completionPct: string | null }
    | null;
  emphasis: boolean;
}) {
  if (!lesson) {
    return (
      <div className="rounded-card border border-dashed border-rule bg-canvas/50 px-4 py-4">
        <div className="text-[11px] uppercase tracking-[0.18em] text-muted">
          {slot}
        </div>
        <div className="mt-1 text-sm text-muted">— start of course —</div>
      </div>
    );
  }
  const pct = lesson.completionPct !== null ? Number(lesson.completionPct) : null;
  const tone = toneForCompletion(pct);
  const wrapCls = emphasis ? "border-rule bg-cream" : "border-rule bg-canvas";
  const dotCls = {
    unknown: "bg-rule",
    healthy: "bg-forest",
    warm: "bg-terracotta-soft",
    leak: "bg-terracotta",
  }[tone];
  return (
    <div className={`rounded-card border px-4 py-4 ${wrapCls}`}>
      <div className="flex items-center justify-between text-[11px] uppercase tracking-[0.18em] text-muted">
        <span>{slot}</span>
        <span>L{lesson.position}</span>
      </div>
      <div className="mt-1 line-clamp-2 text-sm font-medium text-ink">
        {lesson.title}
      </div>
      <div className="mt-2 flex items-center gap-2">
        <span aria-hidden className={`h-2 w-2 rounded-full ${dotCls}`} />
        <span className="font-display text-xl">
          {pct === null ? "—" : `${Math.round(pct)}%`}
        </span>
      </div>
    </div>
  );
}

type MemberState = "completed" | "incomplete" | "not_started";

function classify(
  pct: number | null,
  completedAt: Date | null,
  lastActivityAt: Date | null,
): MemberState {
  if (completedAt !== null) return "completed";
  if (pct !== null && pct > 0) return "incomplete";
  // Sync writes last_activity_at from Skool updated_at even when % is missing
  if (lastActivityAt !== null) return "incomplete";
  return "not_started";
}

function MemberRow({
  record,
}: {
  record: {
    id: string;
    name: string | null;
    handle: string | null;
    email: string | null;
    progressPct: number | null;
    completedAt: Date | null;
    lastActivityAt: Date | null;
    state: MemberState;
  };
}) {
  const displayName = record.name ?? record.handle ?? record.email ?? "Member";
  const stateLabel = {
    completed: "Completed",
    incomplete: "In progress",
    not_started: "Hasn't started",
  }[record.state];

  const stateClass = {
    completed: "text-forest",
    incomplete: "text-terracotta-ink",
    not_started: "text-muted",
  }[record.state];

  const ts =
    record.state === "completed"
      ? record.completedAt
      : record.lastActivityAt;

  return (
    <tr>
      <td className="px-4 py-3">
        <div className="text-sm font-medium text-ink">{displayName}</div>
        {record.handle ? (
          <div className="text-xs text-muted">@{record.handle}</div>
        ) : null}
      </td>
      <td className="px-4 py-3">
        <span className={`text-sm ${stateClass}`}>{stateLabel}</span>
        {record.state === "incomplete" && record.progressPct !== null ? (
          <span className="ml-2 text-xs text-muted">
            ({Math.round(record.progressPct)}% through)
          </span>
        ) : null}
      </td>
      <td className="px-4 py-3 text-sm text-muted">
        {ts ? `${minutesAgo(ts)} ago` : "—"}
      </td>
    </tr>
  );
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
