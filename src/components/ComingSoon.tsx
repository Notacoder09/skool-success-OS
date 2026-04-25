// Honest placeholder for views that ship later in the build sequence.
// Reused by every sidebar nav target that's not yet wired up. Mirrors
// Operating Principle #5: never display fake data; if we don't have it,
// we say so.

export function ComingSoon({
  feature,
  arrives,
  description,
}: {
  feature: string;
  arrives: string;
  description: string;
}) {
  return (
    <div className="max-w-2xl">
      <p className="text-xs uppercase tracking-[0.18em] text-muted">{arrives}</p>
      <h1 className="mt-2 font-display text-4xl">{feature}.</h1>
      <p className="mt-3 max-w-xl text-base text-muted">{description}</p>

      <div className="mt-8 rounded-card border border-rule bg-cream px-6 py-5 text-sm text-terracotta-ink">
        This view goes live as part of the locked build sequence in
        docs/skool-success-os-master-plan.md, Part 9.
      </div>
    </div>
  );
}
