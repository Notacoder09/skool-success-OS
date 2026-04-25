import { Logo } from "@/components/Logo";

export default function CheckEmailPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-16">
      <div className="mb-10">
        <Logo />
      </div>
      <h1 className="font-display text-3xl leading-tight">Check your email.</h1>
      <p className="mt-3 text-base text-muted">
        We just sent you a sign-in link. It works once and expires in 10 minutes.
      </p>
      <p className="mt-6 text-sm text-muted">
        Wrong email or link expired?{" "}
        <a className="text-ink underline-offset-4 hover:underline" href="/sign-in">
          Try again
        </a>
        .
      </p>
    </main>
  );
}
