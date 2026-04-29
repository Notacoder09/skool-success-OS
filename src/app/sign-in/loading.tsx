export default function SignInLoading() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-16">
      <div className="mb-10 h-8 w-40 animate-pulse rounded bg-rule/50" aria-hidden />
      <div className="h-8 w-72 max-w-full animate-pulse rounded bg-rule/45" aria-hidden />
      <div className="mt-4 h-4 w-full animate-pulse rounded bg-rule/35" aria-hidden />
      <div className="mt-8 h-24 animate-pulse rounded-lg border border-rule bg-cream/50" aria-hidden />
    </main>
  );
}
