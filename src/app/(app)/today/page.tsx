import { getCurrentCreator, getSkoolConnection } from "@/lib/server/creator";

// Day 1 placeholder for the locked V2 "Today" view (mockup screen 1).
// Real Pulse + Check-ins data lands Days 8-10. Until then, we render
// honest empty/connect states — never fake numbers (Operating Principle #5).

export default async function TodayPage() {
  const creator = await getCurrentCreator();
  if (!creator) return null;

  const connection = await getSkoolConnection(creator.creatorId);
  const greeting = greetingForHour(new Date(), creator.timezone);
  const firstName = creator.email.split("@")[0];

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
            <span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-forest align-middle" />
            {connection.lastVerifiedAt ? "Synced just now" : "Not synced yet"}
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

      {!connection.connected ? <ConnectFirstCard /> : <TodayMetricsPlaceholder />}
    </div>
  );
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

function TodayMetricsPlaceholder() {
  return (
    <section className="mt-10 rounded-card border border-rule bg-canvas p-6">
      <div className="text-xs uppercase tracking-[0.18em] text-muted">Coming up</div>
      <p className="mt-3 text-base leading-relaxed text-ink">
        Your Today view goes live once we&apos;ve had a few days to learn
        your community. The Pulse and Member Check-ins features land Days 8-10
        of the build sequence — until then, your data is here and waiting.
      </p>
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
