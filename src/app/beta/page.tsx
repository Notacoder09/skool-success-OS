import Link from "next/link";

import { Logo } from "@/components/Logo";

/** Public beta / waitlist page (Day 14). No signup form in-app — avoids new DB/API scope. */

export default function BetaWaitlistPage() {
  const contact = process.env.BETA_CONTACT_EMAIL ?? "founder@coursesuccess.io";

  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center px-6 py-16">
      <Logo />
      <p className="mt-10 text-xs uppercase tracking-[0.18em] text-muted">
        Founding cohort
      </p>
      <h1 className="mt-4 font-display text-4xl leading-tight md:text-5xl">
        Beta access is invite-only for now.
      </h1>
      <p className="mt-5 max-w-lg text-lg leading-relaxed text-muted">
        We&apos;re onboarding roughly 10&ndash;20 friendly creators first — people who&apos;ll tell us what&apos;s noisy, what&apos;s missing, and what actually moves retention before we open wider.
      </p>
      <section className="mt-10 rounded-card border border-rule bg-cream p-6">
        <h2 className="font-display text-2xl">How to join</h2>
        <ul className="mt-4 list-inside list-decimal space-y-3 text-base leading-relaxed text-ink">
          <li>
            Email{" "}
            <a href={`mailto:${contact}?subject=CourseSuccess%20beta`} className="font-medium text-terracotta-ink underline underline-offset-4 hover:text-ink">
              {contact}
            </a>{" "}
            with &ldquo;CourseSuccess beta&rdquo; and the Skool URL you&apos;d connect.
          </li>
          <li>We&apos;ll add your address to the allowlist — you&apos;ll get a reply when sign-in opens for you.</li>
          <li>
            Then use{" "}
            <Link href="/sign-in" className="font-medium text-terracotta-ink underline underline-offset-4 hover:text-ink">
              Sign in
            </Link>{" "}
            with that same email; you&apos;ll get a magic link, no password.
          </li>
        </ul>
      </section>
      <p className="mt-8 text-xs text-muted">
        Already cleared? Head to{" "}
        <Link href="/sign-in" className="text-terracotta-ink underline underline-offset-4 hover:text-ink">
          Sign in
        </Link>
        .
      </p>
      <Link href="/" className="mt-10 text-sm text-muted hover:text-ink">
        ← Back home
      </Link>
    </main>
  );
}
