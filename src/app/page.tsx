import Link from "next/link";

// Placeholder landing page. Replaced by the marketing site / signed-in
// "Today" view (V2 mockup screen 1) during Days 8-10. This file exists
// so the scaffold renders something honest on Day 1 instead of a
// Next.js default page.
export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center px-6 py-16">
      <p className="text-sm uppercase tracking-[0.18em] text-muted">
        Skool<span className="text-terracotta">Success</span> &middot; Founding · v0
      </p>
      <h1 className="mt-6 font-display text-5xl leading-tight">
        Help your community actually <em>finish</em> what they started.
      </h1>
      <p className="mt-6 max-w-xl text-lg text-muted">
        Better retention, less churn, members who stick around. Skool Success OS catches
        members before they cancel, fixes the lessons people drop off on, and ships
        student-facing flashcards by email — without making you log into yet another dashboard
        daily.
      </p>
      <div className="mt-10 flex items-center gap-4 text-sm">
        <span className="rounded-full border border-rule bg-cream px-3 py-1 text-terracotta-ink">
          v1 in build · day 1
        </span>
        <Link
          className="text-ink underline-offset-4 hover:underline"
          href="https://github.com/"
        >
          Read the master plan
        </Link>
      </div>
    </main>
  );
}
