import { redirect } from "next/navigation";

import { auth, signIn } from "@/auth";
import { Logo } from "@/components/Logo";

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const session = await auth();
  if (session?.user) redirect("/today");

  const fromParam = typeof searchParams.from === "string" ? searchParams.from : "/today";

  async function startSignIn(formData: FormData) {
    "use server";
    const email = String(formData.get("email") ?? "")
      .trim()
      .toLowerCase();
    if (!email) return;
    await signIn("resend", {
      email,
      redirectTo: fromParam,
    });
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-16">
      <div className="mb-10">
        <Logo />
      </div>

      <h1 className="font-display text-3xl leading-tight">
        Sign in to <em className="not-italic">Skool Success</em>.
      </h1>
      <p className="mt-3 text-base text-muted">
        We&apos;ll email you a one-time link. No password to remember.
      </p>

      <form action={startSignIn} className="mt-8 flex flex-col gap-3">
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
        Beta access is invite-only right now. If you don&apos;t have an account
        yet, the email won&apos;t arrive.
      </p>
    </main>
  );
}
