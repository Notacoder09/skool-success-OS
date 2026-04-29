import Link from "next/link";
import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { Logo } from "@/components/Logo";

import { requestMagicLink } from "./actions";

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const session = await auth();
  if (session?.user) redirect("/today");

  const fromParam = typeof searchParams.from === "string" ? searchParams.from : "/today";
  const errorParam =
    typeof searchParams.error === "string" ? searchParams.error : undefined;

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-16">
      <div className="mb-10">
        <Logo />
      </div>

      <h1 className="font-display text-3xl leading-tight">
        Sign in to <em className="not-italic">CourseSuccess</em>.
      </h1>
      <p className="mt-3 text-base text-muted">
        We&apos;ll email you a one-time link. No password to remember.
      </p>

      {errorParam === "invite_only" ? (
        <div
          className="mt-6 rounded-lg border border-rule bg-cream px-4 py-3 text-sm leading-relaxed text-ink"
          role="status"
        >
          This email isn&apos;t on the beta list yet — we&apos;re keeping the first
          cohort small. Request access first, then come back once you&apos;re on
          the list.
          <Link
            href="/beta"
            className="mt-3 block font-medium text-terracotta-ink underline underline-offset-4 hover:text-ink"
          >
            How to request beta access →
          </Link>
        </div>
      ) : null}

      <form action={requestMagicLink} className="mt-8 flex flex-col gap-3">
        <input type="hidden" name="from" value={fromParam} />
        <label className="text-sm text-muted" htmlFor="email">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          required
          autoComplete="email"
          placeholder="you@example.com"
          className="rounded-lg border border-rule bg-canvas px-4 py-3 text-base outline-none ring-terracotta/30 focus:ring-2"
        />
        <button
          type="submit"
          className="mt-2 rounded-lg bg-ink px-4 py-3 text-base text-canvas hover:bg-ink/90"
        >
          Email me a sign-in link
        </button>
      </form>

      <p className="mt-8 text-xs text-muted">
        Beta access uses a small invite list until we&apos;re ready to open up
        publicly.{" "}
        <Link href="/beta" className="text-terracotta-ink underline underline-offset-4 hover:text-ink">
          Request access
        </Link>
      </p>
    </main>
  );
}
