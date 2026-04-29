import Link from "next/link";

import { auth } from "@/auth";
import { redirect } from "next/navigation";

export default async function HomePage() {
  const session = await auth();
  if (session?.user) redirect("/today");
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center px-6 py-16">
      <p className="text-sm uppercase tracking-[0.18em] text-muted">
        Course<span className="text-terracotta">Success</span> &middot; Founding cohort
      </p>
      <h1 className="mt-6 font-display text-5xl leading-tight">
        Help your community actually <em>finish</em> what they started.
      </h1>
      <p className="mt-6 max-w-xl text-lg text-muted">
        Better retention, less churn, members who stick around. CourseSuccess catches
        members before they cancel, fixes the lessons people drop off on, and ships
        student-facing flashcards by email — without making you live in another dashboard.
      </p>
      <div className="mt-10 flex flex-wrap items-center gap-4 text-sm">
        <Link
          href="/sign-in"
          className="rounded-lg bg-ink px-4 py-3 text-canvas hover:bg-ink/90"
        >
          Sign in
        </Link>
        <Link href="/beta" className="text-muted underline-offset-4 hover:text-ink hover:underline">
          Request beta access
        </Link>
      </div>
    </main>
  );
}
