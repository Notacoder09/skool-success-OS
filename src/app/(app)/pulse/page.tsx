import Link from "next/link";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";

import { ConnectFirstCard } from "@/components/ConnectFirstCard";
import { db } from "@/db";
import { communityMetricsDaily } from "@/db/schema/communities";
import { firstNameFrom } from "@/lib/checkins";
import { loadDailyCheckIns } from "@/lib/checkins/load";
import {
  activityByDayOfWeek,
  latestValue,
  trendOverWindow,
  type DailyPoint,
  type TrendDelta,
} from "@/lib/pulse/aggregate";
import {
  getCurrentCreator,
  getPrimaryCommunity,
  getSkoolConnection,
} from "@/lib/server/creator";

// Community Pulse (Feature 3).
//
// Wisdom doc Feature 3 (verbatim copy direction):
//   - Default view answers "what's the temperature of my community
//     this week?" — qualitative read first, numbers second
//   - Replace "Active Members" with "Regulars This Week"
//   - Replace "Engagement Rate" with "Posts that landed"
//   - Add a "Who to DM today" widget
//   - v1: posts/likes ship as "coming soon" tiles
//
// Source data is `community_metrics_daily`, populated by sync step E.
// Everything renders from the DB — no live Skool calls on render.

const DAYS_OF_WEEK = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default async function PulsePage() {
  const creator = await getCurrentCreator();
  if (!creator) redirect("/sign-in");

  const connection = await getSkoolConnection(creator.creatorId);
  const community = await getPrimaryCommunity(creator.creatorId);

  if (!connection.connected || !community) {
    return (
      <div className="max-w-5xl">
        <PageHeader />
        <div className="mt-8">
          <ConnectFirstCard feature="your community pulse" />
        </div>
      </div>
    );
  }

  // Pull the 30-day window for this community.
  const rawPoints = await db
    .select({
      metricDate: communityMetricsDaily.metricDate,
      totalMembers: communityMetricsDaily.totalMembers,
      activeMembers: communityMetricsDaily.activeMembers,
      dailyActivities: communityMetricsDaily.dailyActivities,
    })
    .from(communityMetricsDaily)
    .where(eq(communityMetricsDaily.communityId, community.id));

  const points: DailyPoint[] = rawPoints.map((r) => ({
    date: r.metricDate,
    totalMembers: r.totalMembers,
    activeMembers: r.activeMembers,
    dailyActivities: r.dailyActivities,
  }));

  // "Who to DM today" — top 3 from the same loader /check-ins uses,
  // so the lists agree.
  const checkIns = await loadDailyCheckIns({
    communityId: community.id,
    creatorId: creator.creatorId,
    cap: 3,
  });

  const totalMembersTrend = trendOverWindow(points, "totalMembers", 30);
  const regularsTrend = trendOverWindow(points, "activeMembers", 7);
  const activityTrend = trendOverWindow(points, "dailyActivities", 7);
  const dowSums = activityByDayOfWeek(points);
  const regularsLatest = latestValue(points, "activeMembers");

  return (
    <div className="max-w-5xl">
      <PageHeader />

      {points.length === 0 ? (
        <PendingFirstSync lastSyncedAt={community.lastSyncedAt} />
      ) : (
        <>
          <section className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-3">
            <MetricTile
              label="Members"
              value={latestValue(points, "totalMembers")}
              trend={totalMembersTrend}
              suffix="total"
              trendLabel="vs 30d ago"
            />
            <MetricTile
              label="Regulars this week"
              value={regularsLatest}
              trend={regularsTrend}
              suffix="active"
              trendLabel="vs last week"
            />
            <MetricTile
              label="Daily activity"
              value={latestValue(points, "dailyActivities")}
              trend={activityTrend}
              suffix="today"
              trendLabel="vs last week"
            />
          </section>

          <section className="mt-8 rounded-card border border-rule bg-canvas p-6">
            <div className="flex items-baseline justify-between">
              <h2 className="font-display text-2xl">When your community is on</h2>
              <span className="text-xs text-muted">
                Last 30 days · daily activity sum
              </span>
            </div>
            <DayOfWeekStrip sums={dowSums} />
            <p className="mt-3 text-xs leading-relaxed text-muted">
              {explainDayOfWeek(dowSums)}
            </p>
          </section>

          <section className="mt-8 rounded-card border border-rule bg-cream p-6">
            <div className="text-xs uppercase tracking-[0.18em] text-terracotta-ink">
              Who to DM today
            </div>
            {checkIns.length === 0 ? (
              <p className="mt-3 max-w-xl text-base leading-relaxed text-ink">
                No one stuck or quiet right now — keep showing up in the
                feed. The list refreshes as the sync picks up new
                activity patterns.
              </p>
            ) : (
              <ul className="mt-4 space-y-3">
                {checkIns.map((row) => {
                  const display = row.name?.trim() || row.email || "Unknown";
                  const first = firstNameFrom(row.name) ?? display;
                  return (
                    <li key={row.memberId} className="flex items-baseline gap-3">
                      <span className="font-display text-lg text-ink">{first}</span>
                      <span className="text-sm text-muted">— {row.flag.reason}</span>
                    </li>
                  );
                })}
                <li className="pt-2 text-sm">
                  <Link
                    href="/check-ins"
                    className="font-medium text-terracotta-ink underline-offset-4 hover:underline"
                  >
                    Open Member Check-ins →
                  </Link>
                </li>
              </ul>
            )}
          </section>

          <ComingSoonTiles />
        </>
      )}
    </div>
  );
}

function PageHeader() {
  return (
    <header>
      <h1 className="font-display text-5xl leading-tight">
        Community <em className="font-display not-italic">Pulse</em>
      </h1>
      <p className="mt-3 max-w-2xl text-lg text-muted">
        What&apos;s the temperature of your community this week?
      </p>
    </header>
  );
}

function MetricTile({
  label,
  value,
  trend,
  suffix,
  trendLabel,
}: {
  label: string;
  value: number | null;
  trend: TrendDelta | null;
  suffix: string;
  trendLabel: string;
}) {
  return (
    <div className="rounded-card border border-rule bg-canvas p-5">
      <div className="text-xs uppercase tracking-[0.18em] text-muted">{label}</div>
      <div className="mt-2 flex items-baseline gap-2">
        <span className="font-display text-4xl">
          {value === null ? "—" : value.toLocaleString()}
        </span>
        <span className="text-sm text-muted">{suffix}</span>
      </div>
      {trend ? (
        <div className="mt-2 flex items-center gap-2 text-xs">
          <TrendBadge trend={trend} />
          <span className="text-muted">{trendLabel}</span>
        </div>
      ) : (
        <div className="mt-2 text-xs text-muted/70">Not enough history yet</div>
      )}
    </div>
  );
}

function TrendBadge({ trend }: { trend: TrendDelta }) {
  const tone =
    trend.trend === "up"
      ? "bg-forest/15 text-forest"
      : trend.trend === "down"
        ? "bg-terracotta/15 text-terracotta-ink"
        : "border border-rule bg-canvas text-muted";
  const arrow =
    trend.trend === "up" ? "↑" : trend.trend === "down" ? "↓" : "→";
  const pct =
    trend.pctDelta === null
      ? `${trend.delta >= 0 ? "+" : ""}${trend.delta}`
      : `${trend.pctDelta >= 0 ? "+" : ""}${Math.round(trend.pctDelta)}%`;
  return (
    <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${tone}`}>
      {arrow} {pct}
    </span>
  );
}

function DayOfWeekStrip({ sums }: { sums: number[] }) {
  const max = Math.max(1, ...sums);
  return (
    <div className="mt-4 grid grid-cols-7 gap-2">
      {sums.map((v, i) => {
        const heightPct = Math.round((v / max) * 100);
        return (
          <div key={i} className="flex flex-col items-center gap-1.5">
            <div className="flex h-24 w-full items-end overflow-hidden rounded-md bg-cream/60">
              <div
                className="w-full rounded-md bg-terracotta/40"
                style={{ height: `${Math.max(heightPct, 4)}%` }}
                aria-label={`${DAYS_OF_WEEK[i]}: ${v} activities`}
              />
            </div>
            <div className="text-[11px] uppercase tracking-[0.16em] text-muted">
              {DAYS_OF_WEEK[i]}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function explainDayOfWeek(sums: number[]): string {
  const total = sums.reduce((a, b) => a + b, 0);
  if (total === 0) return "No activity recorded yet — give the sync a day or two.";
  let topIdx = 0;
  for (let i = 1; i < sums.length; i += 1) {
    if ((sums[i] ?? 0) > (sums[topIdx] ?? 0)) topIdx = i;
  }
  const day = DAYS_OF_WEEK[topIdx] ?? "—";
  return `${day} is when your community shows up most. Schedule live calls and big posts there.`;
}

function ComingSoonTiles() {
  return (
    <section className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2">
      <ComingSoonTile
        title="Posts that landed"
        body="Top posts by likes + comments, ranked weekly. Lands when the Skool feed scraper ships."
      />
      <ComingSoonTile
        title="Likes activity"
        body="Sam's #1 lightweight engagement signal. Lands with feed integration."
      />
    </section>
  );
}

function ComingSoonTile({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-card border border-dashed border-rule bg-canvas/60 p-5">
      <div className="flex items-baseline justify-between">
        <h3 className="font-display text-xl text-ink">{title}</h3>
        <span className="text-[11px] uppercase tracking-[0.16em] text-muted">
          Coming soon
        </span>
      </div>
      <p className="mt-2 text-sm leading-relaxed text-muted">{body}</p>
    </div>
  );
}

function PendingFirstSync({ lastSyncedAt }: { lastSyncedAt: Date | null }) {
  return (
    <section className="mt-10 rounded-card border border-rule bg-cream p-6">
      <div className="text-xs uppercase tracking-[0.18em] text-terracotta-ink">
        {lastSyncedAt ? "Building your pulse" : "Pending first sync"}
      </div>
      <p className="mt-3 max-w-xl text-base leading-relaxed text-ink">
        {lastSyncedAt ? (
          <>
            We&apos;ve synced your community but haven&apos;t pulled the
            activity time-series yet — it lands on the next sync. In the
            meantime, the{" "}
            <Link href="/drop-off" className="underline-offset-4 hover:underline">
              Drop-Off Map
            </Link>{" "}
            already has data.
          </>
        ) : (
          <>
            Pulse fills in after the first sync. From{" "}
            <Link href="/drop-off" className="underline-offset-4 hover:underline">
              Drop-Off Map
            </Link>
            , click &ldquo;Refresh now&rdquo; to kick one off.
          </>
        )}
      </p>
    </section>
  );
}
