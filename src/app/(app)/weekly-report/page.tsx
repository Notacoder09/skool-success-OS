import { desc, eq } from "drizzle-orm";
import { redirect } from "next/navigation";

import { ConnectFirstCard } from "@/components/ConnectFirstCard";
import { db } from "@/db";
import { weeklyReports } from "@/db/schema/reports";
import { parseMarkdownBlocks } from "@/lib/weekly-report/render";
import {
  getCurrentCreator,
  getPrimaryCommunity,
  getSkoolConnection,
} from "@/lib/server/creator";

import { RegenerateWeeklyReportButton } from "./RegenerateButton";

// Days 11-13 — Weekly Optimization Report viewer.
//
// Two layers, top to bottom:
//   1. Latest report — full body (markdown rendered as plain prose).
//      Pills show variant + send status (queued/sent/opened).
//   2. History — last 8 weeks, collapsed to a single line each.
//
// Sending happens server-side via /api/cron/weekly-reports (Monday 7am
// creator-local). The "Regenerate this week" button is for mid-week
// preview/refresh — it never re-emails a report that already shipped.

export const dynamic = "force-dynamic";

const HISTORY_LIMIT = 8;

export default async function WeeklyReportPage() {
  const creator = await getCurrentCreator();
  if (!creator) redirect("/sign-in");

  const connection = await getSkoolConnection(creator.creatorId);
  const community = await getPrimaryCommunity(creator.creatorId);

  const reports = await db
    .select()
    .from(weeklyReports)
    .where(eq(weeklyReports.creatorId, creator.creatorId))
    .orderBy(desc(weeklyReports.weekStartDate))
    .limit(HISTORY_LIMIT + 1);

  const latest = reports[0] ?? null;
  const history = reports.slice(1);

  if (!connection.connected || !community) {
    return (
      <div className="max-w-3xl">
        <PageHeader />
        <div className="mt-8">
          <ConnectFirstCard feature="your weekly report" />
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl">
      <div className="flex flex-wrap items-start justify-between gap-6">
        <PageHeader />
        <RegenerateWeeklyReportButton />
      </div>

      {latest ? (
        <LatestReportCard report={latest} />
      ) : (
        <NotYetCard timezone={creator.timezone} />
      )}

      {history.length > 0 ? <HistoryList reports={history} /> : null}

      <FootnotesCard timezone={creator.timezone} />
    </div>
  );
}

function PageHeader() {
  return (
    <div>
      <h1 className="font-display text-5xl leading-tight">
        Weekly <em className="font-display not-italic">Report</em>
      </h1>
      <p className="mt-3 max-w-xl text-lg text-muted">
        Lands Monday at 7 AM in your local time. Three things to do this
        week, two things to think about — read in three to five minutes.
      </p>
    </div>
  );
}

interface ReportRow {
  id: string;
  weekStartDate: Date;
  variant: "weekly" | "welcome";
  bodyMd: string;
  queuedAt: Date;
  sentAt: Date | null;
  openedAt: Date | null;
  resendMessageId: string | null;
}

function LatestReportCard({ report }: { report: ReportRow }) {
  return (
    <section className="mt-10 rounded-card border border-rule bg-cream p-8">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-[0.18em] text-terracotta-ink">
            {weekLabel(report.weekStartDate)}
          </div>
          <h2 className="mt-2 font-display text-3xl">
            {report.variant === "welcome"
              ? "Welcome to your weekly review"
              : "Your week"}
          </h2>
        </div>
        <div className="flex flex-wrap gap-2">
          <VariantPill variant={report.variant} />
          <SendStatusPill report={report} />
        </div>
      </header>

      <ReportBody markdown={report.bodyMd} />
    </section>
  );
}

function NotYetCard({ timezone }: { timezone: string }) {
  return (
    <section className="mt-10 rounded-card border border-rule bg-canvas p-8">
      <div className="text-xs uppercase tracking-[0.18em] text-muted">
        Not built yet
      </div>
      <p className="mt-3 max-w-xl text-base leading-relaxed text-ink">
        Your first report will land on the next Monday at 7 AM in{" "}
        <strong>{timezone || "UTC"}</strong>. Want a preview now? Hit
        &ldquo;Regenerate this week&rdquo; — it composes the report from
        your current data without sending an email.
      </p>
    </section>
  );
}

function HistoryList({ reports }: { reports: ReportRow[] }) {
  return (
    <section className="mt-10">
      <div className="text-xs uppercase tracking-[0.18em] text-muted">
        Earlier reports
      </div>
      <ul className="mt-3 divide-y divide-rule rounded-card border border-rule bg-canvas">
        {reports.map((r) => (
          <li
            key={r.id}
            className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
          >
            <div>
              <div className="text-sm font-medium text-ink">
                {weekLabel(r.weekStartDate)}
              </div>
              <div className="mt-0.5 text-xs text-muted">
                {r.variant === "welcome" ? "Welcome edition" : "Weekly review"}
                {" · "}
                {sendStatusText(r)}
              </div>
            </div>
            <SendStatusPill report={r} compact />
          </li>
        ))}
      </ul>
    </section>
  );
}

function FootnotesCard({ timezone }: { timezone: string }) {
  return (
    <section className="mt-10 rounded-card border border-rule bg-canvas p-6">
      <div className="text-xs uppercase tracking-[0.18em] text-muted">
        How this works
      </div>
      <ul className="mt-3 space-y-2 text-sm leading-relaxed text-muted">
        <li>
          One report per week. We check every hour and send when it&apos;s
          Monday 7 AM in <strong>{timezone || "UTC"}</strong>.
        </li>
        <li>
          Five sections: three actions for the week, two for context.
          Capped at three actions on purpose — overwhelm beats clarity.
        </li>
        <li>
          Retention &lt; 80% surfaces a question instead of a graph. Past
          day 90 we celebrate by name — Skool&apos;s own data shows churn
          drops by half once a member crosses that mark.
        </li>
        <li>
          The cron is idempotent: same week, same email, only ever sent
          once. Regenerating mid-week refreshes the body but never
          re-mails.
        </li>
      </ul>
    </section>
  );
}

function ReportBody({ markdown }: { markdown: string }) {
  const blocks = parseMarkdownBlocks(markdown);
  return (
    <div className="mt-6 space-y-6">
      {blocks.map((block, idx) => {
        if (block.kind === "h1") {
          return (
            <p
              key={idx}
              className="text-xs uppercase tracking-[0.18em] text-terracotta-ink"
            >
              {block.text}
            </p>
          );
        }
        if (block.kind === "h2") {
          return (
            <h3 key={idx} className="font-display text-2xl text-ink">
              {block.text}
            </h3>
          );
        }
        if (block.kind === "tag") {
          return (
            <div
              key={idx}
              className={`inline-flex rounded-full px-2 py-0.5 text-[10px] uppercase tracking-[0.16em] ${
                block.tone === "action"
                  ? "bg-forest/10 text-forest"
                  : "bg-rule/40 text-muted"
              }`}
            >
              {block.text}
            </div>
          );
        }
        return (
          <p key={idx} className="text-base leading-relaxed text-ink">
            {block.text}
          </p>
        );
      })}
    </div>
  );
}

function VariantPill({ variant }: { variant: "weekly" | "welcome" }) {
  if (variant === "welcome") {
    return (
      <span className="inline-flex items-center rounded-full border border-rule bg-canvas px-2 py-0.5 text-xs text-muted">
        Welcome edition
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-full border border-rule bg-canvas px-2 py-0.5 text-xs text-muted">
      Weekly
    </span>
  );
}

function SendStatusPill({
  report,
  compact = false,
}: {
  report: ReportRow;
  compact?: boolean;
}) {
  const status = getSendStatus(report);
  const map: Record<typeof status, { label: string; cls: string }> = {
    queued: { label: "Queued", cls: "bg-rule/40 text-muted" },
    sent: { label: "Sent", cls: "bg-forest/10 text-forest" },
    opened: { label: "Opened", cls: "bg-forest/20 text-forest" },
  };
  const { label, cls } = map[status];
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs ${cls} ${
        compact ? "text-[10px]" : ""
      }`}
    >
      {label}
    </span>
  );
}

type SendStatus = "queued" | "sent" | "opened";

function getSendStatus(report: ReportRow): SendStatus {
  if (report.openedAt) return "opened";
  if (report.sentAt) return "sent";
  return "queued";
}

function sendStatusText(report: ReportRow): string {
  if (report.openedAt) return `opened ${formatRelative(report.openedAt)}`;
  if (report.sentAt) return `sent ${formatRelative(report.sentAt)}`;
  return `queued ${formatRelative(report.queuedAt)}`;
}

function weekLabel(date: Date): string {
  return `Week of ${date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  })}`;
}

function formatRelative(date: Date): string {
  const diffMs = Date.now() - date.getTime();
  const days = Math.floor(diffMs / (24 * 60 * 60 * 1000));
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  if (days < 30) {
    const weeks = Math.floor(days / 7);
    return `${weeks} week${weeks === 1 ? "" : "s"} ago`;
  }
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

