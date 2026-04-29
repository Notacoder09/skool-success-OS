// Route-level skeleton for authenticated app pages. Shown during
// client-side navigations while the destination `page.tsx` resolves.
// Layout (sidebar) stays mounted — only the main pane loads here.

export default function AppRouteLoading() {
  return (
    <div className="max-w-5xl animate-pulse" aria-busy="true" aria-label="Loading page">
      <div className="h-12 w-64 max-w-[85%] rounded-md bg-rule/55" />
      <div className="mt-4 h-5 w-full max-w-2xl rounded bg-rule/35" />
      <div className="mt-3 h-5 w-[66%] max-w-lg rounded bg-rule/30" />
      <div className="mt-12 grid gap-4 sm:grid-cols-2">
        <div className="h-36 rounded-card border border-rule bg-cream/55" />
        <div className="h-36 rounded-card border border-rule bg-cream/55" />
      </div>
      <div className="mt-6 h-48 rounded-card border border-rule bg-canvas" />
    </div>
  );
}
