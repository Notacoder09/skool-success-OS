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
        DMs to send today, ordered by relationship value — not just risk.
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
  const display = row.name?.trim() || row.email || "Unknown member";
  const firstName = firstNameFrom(row.name);
  const drafts = draftAllTones({ firstName, flag: row.flag });

  return (
    <li
      className={`rounded-card border p-5 transition ${
        row.alreadyDraftedToday
          ? "border-rule bg-canvas/60"
          : "border-rule bg-canvas hover:border-terracotta/40"
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
          </div>
          <p className="mt-2 text-sm leading-relaxed text-ink">
            {row.flag.reason}.
          </p>
          <p className="mt-1 text-xs text-muted">{relationshipSummary(row)}</p>
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

function relationshipSummary(row: CheckInRow): string {
  const parts: string[] = [];
  if (row.joinedAt) {
    parts.push(`Member ${formatTenure(row.joinedAt)}`);
  }
  if (row.completedLessons > 0) {
    parts.push(
      `${row.completedLessons} lesson${row.completedLessons === 1 ? "" : "s"} completed`,
    );
  } else if (row.inProgressLessons > 0) {
    parts.push(
      `${row.inProgressLessons} in progress, none finished`,
    );
  } else {
    parts.push("Hasn't started any lessons yet");
  }
  return parts.join(" · ");
}

function formatTenure(joinedAt: Date): string {
  const days = Math.max(1, Math.floor((Date.now() - joinedAt.getTime()) / 86_400_000));
  if (days < 30) return `${days}d`;
  const months = Math.round(days / 30);
  if (months < 12) return `${months}mo`;
  const years = Math.round(months / 12);
  return `${years}y`;
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
