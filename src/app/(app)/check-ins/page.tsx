import Link from "next/link";
import { redirect } from "next/navigation";

import { ConnectFirstCard } from "@/components/ConnectFirstCard";
import { draftAllTones, firstNameFrom } from "@/lib/checkins";
import { loadDailyCheckIns, type CheckInRow } from "@/lib/checkins/load";
import {
  getCurrentCreator,
  getPrimaryCommunity,
  getSkoolConnection,
} from "@/lib/server/creator";

import { DraftMessageButton } from "./DraftMessageButton";

// Member Check-ins page (Feature 4).
//
// Voice rules from `creator-wisdom-and-product-decisions.md` Feature 4:
//   - Frame as "DMs to send today", not "members at risk of churn"
//   - Show WHY in plain language ("hasn't logged in for 2 weeks…")
//   - Show relationship history ("4 months a member, 60% completion")
//   - Cap the daily list at 5-7 (this code uses 7 — see DAILY_CHECK_IN_CAP)
//
// "Honest disclosure" copy block under the list comes from the
// wisdom doc verbatim: v1 we copy + open Skool, v2 (Chrome ext)
// gives true 1-click send.

export default async function CheckInsPage() {
  const creator = await getCurrentCreator();
  if (!creator) redirect("/sign-in");

  const connection = await getSkoolConnection(creator.creatorId);
  const community = await getPrimaryCommunity(creator.creatorId);

  if (!connection.connected || !community) {
    return (
      <div className="max-w-4xl">
        <PageHeader />
        <div className="mt-8">
          <ConnectFirstCard />
        </div>
      </div>
    );
  }

  const rows = await loadDailyCheckIns({
    communityId: community.id,
    creatorId: creator.creatorId,
  });

  const skoolDmUrl = buildSkoolInboxUrl(community.slug);

  return (
    <div className="max-w-4xl">
      <PageHeader />
      {rows.length === 0 ? (
        <EmptyState lastSyncedAt={community.lastSyncedAt} />
      ) : (
        <CheckInList rows={rows} skoolDmUrl={skoolDmUrl} />
      )}
      <HonestDisclosure />
    </div>
  );
}

function PageHeader() {
  return (
    <header>
      <h1 className="font-display text-5xl leading-tight">
        Member <em className="font-display not-italic">Check-ins</em>
      </h1>
      <p className="mt-3 max-w-2xl text-lg text-muted">
        DMs to send today — quietest members first, then by who&apos;s most
        winnable if there&apos;s a tie.
      </p>
    </header>
  );
}

function CheckInList({
  rows,
  skoolDmUrl,
}: {
  rows: CheckInRow[];
  skoolDmUrl: string;
}) {
  return (
    <section className="mt-8 space-y-3">
      <div className="flex items-baseline justify-between">
        <div className="text-xs uppercase tracking-[0.18em] text-muted">
          Today&apos;s list — {rows.length} {rows.length === 1 ? "name" : "names"}
        </div>
        <div className="text-xs text-muted/70">
          Capped at 7 — anything more is unrealistic to DM in a day.
        </div>
      </div>
      <ul className="space-y-3">
        {rows.map((row) => (
          <CheckInRowCard key={row.memberId} row={row} skoolDmUrl={skoolDmUrl} />
        ))}
      </ul>
    </section>
  );
}

function CheckInRowCard({
  row,
  skoolDmUrl,
}: {
  row: CheckInRow;
  skoolDmUrl: string;
}) {
  const asOf = new Date();
  const display = row.name?.trim() || row.email || "Unknown member";
  const firstName = firstNameFrom(row.name);
  const drafts = draftAllTones({ firstName, flag: row.flag });

  const tier = inactiveUrgencyTier(row, asOf);
  const last = lastActiveDisplay(row, asOf);
  const urgencyLine = urgencySilentLabel(row, asOf);
  const showNeedsDm = tier === "critical";

  const borderClass =
    tier === "critical"
      ? "border-y border-r border-rule border-l-[4px] border-l-red-600"
      : tier === "warning"
        ? "border-y border-r border-rule border-l-[4px] border-l-terracotta"
        : "border border-rule";

  const lastActiveColorClass =
    tier === "critical"
      ? "text-red-600"
      : tier === "warning"
        ? "text-terracotta-ink"
        : "text-ink";

  return (
    <li
      className={`rounded-card p-5 transition ${borderClass} ${
        row.alreadyDraftedToday ? "bg-canvas/60" : "bg-canvas hover:border-terracotta/40"
      }`}
    >
      <div className="flex items-start justify-between gap-6">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-2">
            <h3 className="font-display text-2xl">{display}</h3>
            {row.alreadyDraftedToday ? (
              <span className="rounded-full bg-cream px-2 py-0.5 text-[11px] uppercase tracking-[0.16em] text-terracotta-ink">
                Drafted today
              </span>
            ) : null}
            {row.tier ? (
              <span className="rounded-full border border-rule bg-cream/40 px-2 py-0.5 text-[11px] text-muted">
                {row.tier}
              </span>
            ) : null}
            {showNeedsDm ? (
              <span className="rounded-full bg-red-600/10 px-2.5 py-0.5 text-[11px] font-medium uppercase tracking-[0.12em] text-red-700">
                Needs DM
              </span>
            ) : null}
            {urgencyLine ? (
              <span
                className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium ${
                  tier === "critical"
                    ? "bg-red-600/10 text-red-700"
                    : "bg-terracotta-soft/80 text-terracotta-ink"
                }`}
              >
                {urgencyLine}
              </span>
            ) : null}
          </div>

          <div className="mt-4">
            <div className="flex flex-wrap items-center gap-2">
              {tier === "warning" ? (
                <span
                  className="inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-terracotta-soft text-sm text-terracotta-ink"
                  aria-hidden
                >
                  !
                </span>
              ) : null}
              <p
                className={`font-display text-3xl leading-tight sm:text-4xl ${lastActiveColorClass}`}
              >
                {last.primary}
              </p>
            </div>
          </div>

          <p className="mt-3 text-sm leading-relaxed text-muted">
            {inactivitySubtext(row)}
          </p>
        </div>
        <DraftMessageButton
          memberId={row.memberId}
          drafts={drafts}
          skoolDmUrl={skoolDmUrl}
          alreadyDraftedToday={row.alreadyDraftedToday}
        />
      </div>
    </li>
  );
}

type ActivityTier = "fresh" | "warning" | "critical";

function daysBetween(earlier: Date, later: Date): number {
  return Math.max(0, Math.floor((later.getTime() - earlier.getTime()) / 86_400_000));
}

/** Strongest quiet signal (days) for styling — combines last activity, joins, stall, and risk flag. */
function urgencyDays(row: CheckInRow, asOf: Date): number {
  let u = 0;
  if (row.lastActiveAt) {
    u = Math.max(u, daysBetween(row.lastActiveAt, asOf));
  } else if (row.joinedAt) {
    u = Math.max(u, daysBetween(row.joinedAt, asOf));
  }
  if (row.flag.reasonKind === "stalled_mid_course" && row.flag.stallDays != null) {
    u = Math.max(u, row.flag.stallDays);
  }
  if (row.flag.daysSinceActive != null) {
    u = Math.max(u, row.flag.daysSinceActive);
  }
  if (row.flag.reasonKind === "brand_new_ghost") {
    u = Math.max(u, row.flag.tenureDays);
  }
  return u;
}

function inactiveUrgencyTier(row: CheckInRow, asOf: Date): ActivityTier {
  const u = urgencyDays(row, asOf);
  if (u < 7) return "fresh";
  if (u < 14) return "warning";
  return "critical";
}

function lastActiveDisplay(row: CheckInRow, asOf: Date): { primary: string } {
  if (!row.lastActiveAt) {
    return { primary: "No course activity on record" };
  }
  const d = daysBetween(row.lastActiveAt, asOf);
  if (d === 0) return { primary: "Last active today" };
  if (d === 1) return { primary: "Last active yesterday" };
  return { primary: `Last active ${d} days ago` };
}

/** Short badge line for 14+ days quiet (uses combined urgency). */
function urgencySilentLabel(row: CheckInRow, asOf: Date): string | null {
  const u = urgencyDays(row, asOf);
  if (u < 14) return null;
  return `${u} days silent`;
}

function inactivitySubtext(row: CheckInRow): string {
  switch (row.flag.reasonKind) {
    case "tenure_dropoff": {
      const d = row.flag.daysSinceActive ?? 0;
      return `Used to make progress in the course — silent for ${d} day${d === 1 ? "" : "s"}`;
    }
    case "brand_new_ghost": {
      const t = row.flag.tenureDays;
      return `Joined ${t} day${t === 1 ? "" : "s"} ago — hasn't opened a single lesson`;
    }
    case "stalled_mid_course": {
      const sd = row.flag.stallDays ?? 0;
      if (row.stalledLessonPosition != null) {
        return `Progress stalled at Lesson ${row.stalledLessonPosition} for ${sd} day${sd === 1 ? "" : "s"}`;
      }
      return `Progress stalled for ${sd} day${sd === 1 ? "" : "s"}`;
    }
  }
}

function EmptyState({ lastSyncedAt }: { lastSyncedAt: Date | null }) {
  return (
    <section className="mt-10 rounded-card border border-rule bg-cream p-6">
      <div className="text-xs uppercase tracking-[0.18em] text-terracotta-ink">
        {lastSyncedAt ? "Nobody to flag today" : "Pending first sync"}
      </div>
      <p className="mt-3 max-w-xl text-base leading-relaxed text-ink">
        {lastSyncedAt ? (
          <>
            Either everyone&apos;s active, or we don&apos;t have enough
            progression data yet to spot stalls. Run a sync from{" "}
            <Link href="/drop-off" className="underline-offset-4 hover:underline">
              Drop-Off Map
            </Link>
            , then come back tomorrow.
          </>
        ) : (
          <>
            We need course progression data before we can flag at-risk
            members. Connect Skool in{" "}
            <Link href="/settings" className="underline-offset-4 hover:underline">
              Settings
            </Link>{" "}
            and let the first sync finish.
          </>
        )}
      </p>
    </section>
  );
}

function HonestDisclosure() {
  return (
    <section className="mt-8 rounded-card border border-rule bg-canvas p-5 text-sm text-muted">
      <p className="leading-relaxed">
        <span className="font-medium text-ink">How &ldquo;Draft message&rdquo; works.</span>{" "}
        Skool doesn&apos;t allow us to send DMs directly yet. One click copies
        the draft, one paste in Skool sends it. The Chrome extension we
        ship next will make it true 1-click.
      </p>
    </section>
  );
}

function buildSkoolInboxUrl(slug: string | null): string {
  // Skool deeplinks aren't documented for "DM this specific member",
  // so we land the creator on their inbox view. From there, picking a
  // person is one click. If we know the community slug we go to the
  // community first (some creators have multiple inboxes).
  if (slug) {
    return `https://www.skool.com/${encodeURIComponent(slug)}`;
  }
  return "https://www.skool.com/";
}
