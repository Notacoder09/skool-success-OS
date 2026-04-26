// Wordmark used in the sidebar and on the marketing landing page.
// Lowercase "Course" + italic Fraunces "Success" matches the current brand.

export function Logo({ subtitle = "founding · v1" }: { subtitle?: string }) {
  return (
    <div className="leading-tight">
      <span className="font-display text-xl text-ink">
        Course<em className="not-italic text-ink">Success</em>
      </span>
      <div className="mt-1 text-[10px] uppercase tracking-[0.2em] text-muted">{subtitle}</div>
    </div>
  );
}
