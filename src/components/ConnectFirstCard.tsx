// Shared "you need to connect Skool first" card. Used by /today,
// /check-ins, /pulse — anywhere a feature requires an active sync.
//
// Copy is honest: 60-second connect flow, no marketing language. Tone
// rules from the master plan Part 6.

export function ConnectFirstCard({
  feature = "this view",
}: {
  feature?: string;
}) {
  return (
    <section className="rounded-card border border-rule bg-cream p-6">
      <div className="text-xs uppercase tracking-[0.18em] text-terracotta-ink">
        Connect Skool first
      </div>
      <p className="mt-3 max-w-xl text-base leading-relaxed text-ink">
        {feature === "this view"
          ? "We'll fill this in once Skool is connected."
          : `We'll fill in ${feature} once Skool is connected.`}{" "}
        It takes about 60 seconds — paste two cookies from your logged-in
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
