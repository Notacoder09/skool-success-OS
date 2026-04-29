import Link from "next/link";
import { redirect } from "next/navigation";

import { ConnectFirstCard } from "@/components/ConnectFirstCard";
import {
  loadFlashcardsOverview,
  type FlashcardLessonRow,
  type FlashcardOverview,
} from "@/lib/flashcards/load";
import {
  getCurrentCreator,
  getPrimaryCommunity,
  getSkoolConnection,
} from "@/lib/server/creator";

import { DispatchSendsButton, RegenerateAllButton } from "./RegenerateButtons";

// Days 11-13 — Flashcards page (Feature 2).
//
// The view shows three things, top to bottom:
//   1. Settings + quota card (transcription toggle lives in /settings;
//      we just surface the state and quota usage here).
//   2. Per-lesson source attribution table — never silently transcribe
//      or skip; per the wisdom doc the creator always knows what
//      happened for each lesson.
//   3. Sends summary — how many emails actually went out today / total.

export default async function FlashcardsPage() {
  const creator = await getCurrentCreator();
  if (!creator) redirect("/sign-in");

  const connection = await getSkoolConnection(creator.creatorId);
  const community = await getPrimaryCommunity(creator.creatorId);

  if (!connection.connected || !community) {
    return (
      <div className="max-w-5xl">
        <PageHeader />
        <div className="mt-8">
          <ConnectFirstCard feature="flashcards" />
        </div>
      </div>
    );
  }

  const overview = await loadFlashcardsOverview({
    creatorId: creator.creatorId,
    communityId: community.id,
  });

  return (
    <div className="max-w-5xl">
      <div className="flex flex-wrap items-start justify-between gap-6">
        <PageHeader />
        <div className="flex flex-wrap items-start gap-3">
          <RegenerateAllButton />
          <DispatchSendsButton />
        </div>
      </div>

      <SettingsAndQuotaCard
        overview={overview}
        transcriptionEnabled={creator.transcriptionEnabled}
      />

      <SendsSummaryCard overview={overview} />

      <PerLessonTable rows={overview.rows} />

      <FootnotesCard />
    </div>
  );
}

function PageHeader() {
  return (
    <header>
      <h1 className="font-display text-5xl leading-tight">
        <em className="font-display not-italic">Flashcards</em>
      </h1>
      <p className="mt-3 max-w-2xl text-lg text-muted">
        3-5 cards per lesson, sent to your members 24-48 hours after they
        finish. Cheap sources first; you always see where each set came
        from.
      </p>
    </header>
  );
}

function SettingsAndQuotaCard({
  overview,
  transcriptionEnabled,
}: {
  overview: FlashcardOverview;
  transcriptionEnabled: boolean;
}) {
  const { quota, totals } = overview;
  const usedPct = quota.unlimited
    ? 0
    : Math.min(100, Math.round((quota.minutesUsedThisMonth / quota.quotaMinutes) * 100));

  return (
    <section className="mt-8 rounded-card border border-rule bg-canvas px-6 py-5">
      <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
        <div>
          <div className="text-xs uppercase tracking-[0.18em] text-muted">
            Generation
          </div>
          <div className="mt-2 text-2xl font-medium text-ink">
            {totals.withCards} / {totals.lessons}
          </div>
          <p className="mt-1 text-xs text-muted">
            lessons have cards ready. {totals.skippedThinSignal} skipped for
            thin content.
          </p>
        </div>

        <div>
          <div className="text-xs uppercase tracking-[0.18em] text-muted">
            Transcription
          </div>
          <div className="mt-2 flex items-center gap-2">
            <span
              className={`inline-block h-2 w-2 rounded-full ${
                transcriptionEnabled ? "bg-forest" : "bg-rule"
              }`}
            />
            <span className="text-sm font-medium text-ink">
              {transcriptionEnabled ? "On" : "Off — default"}
            </span>
          </div>
          <p className="mt-1 text-xs text-muted">
            {transcriptionEnabled
              ? "Video-only lessons run through Whisper when nothing cheaper works."
              : "Video-only lessons skip until you opt in."}{" "}
            <Link
              href="/settings"
              className="underline-offset-4 hover:underline"
            >
              Change in Settings →
            </Link>
          </p>
        </div>

        <div>
          <div className="text-xs uppercase tracking-[0.18em] text-muted">
            This month&apos;s Whisper minutes
          </div>
          <div className="mt-2 text-2xl font-medium text-ink">
            {quota.unlimited
              ? `${quota.minutesUsedThisMonth} / ∞`
              : `${quota.minutesUsedThisMonth} / ${quota.quotaMinutes}`}
          </div>
          {!quota.unlimited ? (
            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-rule">
              <div
                className={`h-full ${usedPct >= 90 ? "bg-terracotta" : "bg-forest"}`}
                style={{ width: `${usedPct}%` }}
              />
            </div>
          ) : null}
          <p className="mt-2 text-xs text-muted">
            Cached transcripts are free forever — re-runs don&apos;t count.
          </p>
        </div>
      </div>
    </section>
  );
}

function SendsSummaryCard({ overview }: { overview: FlashcardOverview }) {
  return (
    <section className="mt-6 rounded-card border border-rule bg-canvas px-6 py-5">
      <div className="grid grid-cols-2 gap-6 md:grid-cols-4">
        <Stat
          label="Sent today"
          value={overview.totals.sentToday}
          tone={overview.totals.sentToday > 0 ? "active" : "idle"}
        />
        <Stat
          label="Sent all-time"
          value={overview.totals.sentAllTime}
          tone="idle"
        />
        <Stat
          label="Skipped — quota"
          value={overview.totals.skippedQuotaReached}
          tone={overview.totals.skippedQuotaReached > 0 ? "warn" : "idle"}
        />
        <Stat
          label="Skipped — video-only off"
          value={overview.totals.skippedTranscriptionDisabled}
          tone="idle"
        />
      </div>
    </section>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "active" | "idle" | "warn";
}) {
  const valueColor =
    tone === "warn"
      ? "text-terracotta-ink"
      : tone === "active"
      ? "text-forest"
      : "text-ink";
  return (
    <div>
      <div className="text-xs uppercase tracking-[0.18em] text-muted">
        {label}
      </div>
      <div className={`mt-2 text-2xl font-medium ${valueColor}`}>{value}</div>
    </div>
  );
}

function PerLessonTable({ rows }: { rows: FlashcardLessonRow[] }) {
  if (rows.length === 0) {
    return (
      <section className="mt-6 rounded-card border border-rule bg-cream p-6">
        <div className="text-xs uppercase tracking-[0.18em] text-terracotta-ink">
          Pending first sync
        </div>
        <p className="mt-3 max-w-xl text-base leading-relaxed text-ink">
          We need to pull your courses before we can scan lessons. Open{" "}
          <Link href="/drop-off" className="underline-offset-4 hover:underline">
            Drop-Off Map
          </Link>{" "}
          and tap <strong className="text-ink">Refresh now</strong>, then come
          back here.
        </p>
      </section>
    );
  }

  // Group rows by course for a clearer scan.
  const byCourse = new Map<string, { title: string; rows: FlashcardLessonRow[] }>();
  for (const r of rows) {
    if (!byCourse.has(r.courseId)) {
      byCourse.set(r.courseId, { title: r.courseTitle, rows: [] });
    }
    byCourse.get(r.courseId)!.rows.push(r);
  }

  return (
    <section className="mt-8 space-y-8">
      {[...byCourse.entries()].map(([courseId, { title, rows: courseRows }]) => (
        <div key={courseId}>
          <h2 className="font-display text-2xl">{title}</h2>
          <div className="mt-3 overflow-hidden rounded-card border border-rule bg-canvas">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="bg-cream/40 text-xs uppercase tracking-[0.16em] text-muted">
                  <th className="w-10 px-4 py-3">#</th>
                  <th className="px-4 py-3">Lesson</th>
                  <th className="px-4 py-3">Source</th>
                  <th className="px-4 py-3">Cards</th>
                  <th className="px-4 py-3">Sent</th>
                </tr>
              </thead>
              <tbody>
                {courseRows.map((r) => (
                  <LessonRow key={r.lessonId} row={r} />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </section>
  );
}

function LessonRow({ row }: { row: FlashcardLessonRow }) {
  return (
    <tr className="border-t border-rule">
      <td className="px-4 py-3 text-muted">{row.positionInCourse}</td>
      <td className="px-4 py-3 text-ink">{row.lessonTitle}</td>
      <td className="px-4 py-3">
        <SourcePill label={row.sourceLabel} tone={row.sourceTone} />
      </td>
      <td className="px-4 py-3 text-ink">
        {row.hasCards ? `${row.cardCount}` : <span className="text-muted">—</span>}
      </td>
      <td className="px-4 py-3 text-ink">
        {row.sentCount > 0 ? (
          <span>
            {row.sentCount}
            {row.firstSentAt ? (
              <span className="ml-2 text-xs text-muted">
                first {row.firstSentAt.toLocaleDateString()}
              </span>
            ) : null}
          </span>
        ) : (
          <span className="text-muted">—</span>
        )}
      </td>
    </tr>
  );
}

function SourcePill({
  label,
  tone,
}: {
  label: string;
  tone: "neutral" | "warning" | "muted";
}) {
  const cls =
    tone === "warning"
      ? "bg-terracotta/10 text-terracotta-ink"
      : tone === "muted"
      ? "bg-cream text-muted"
      : "bg-forest/10 text-forest";
  return (
    <span
      className={`inline-block rounded-full px-2.5 py-0.5 text-xs ${cls}`}
    >
      {label}
    </span>
  );
}

function FootnotesCard() {
  return (
    <section className="mt-8 rounded-card border border-rule bg-canvas p-5 text-sm text-muted">
      <p className="leading-relaxed">
        <span className="font-medium text-ink">How sourcing works.</span>{" "}
        For each lesson we try, in order: lesson description, attached PDF
        (lands next sprint), cached transcript, then Whisper if you&apos;ve
        opted in and have quota left. Re-using a cached transcript is
        always free.
      </p>
    </section>
  );
}
