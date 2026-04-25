import { Logo } from "@/components/Logo";

// Lightweight in-app walkthrough. Public route so creators can preview
// it from the marketing site too. The full screenshot-led version lands
// in onboarding on Day 14 — this page exists so the "How do I find
// these?" link in Settings is never a dead end.

export default function ConnectSkoolHelp() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-16 text-ink">
      <div className="mb-8">
        <Logo />
      </div>

      <h1 className="font-display text-4xl">Connect your Skool community.</h1>
      <p className="mt-3 text-base text-muted">
        Three values, all from your own logged-in Skool browser tab. We never
        log them, encrypt them at rest, and you can revoke any time.
      </p>

      <Step n="1" title="Open your Skool community in Chrome (or any modern browser)">
        Sign in normally. Open the community you own — the one you want us
        connected to.
      </Step>

      <Step n="2" title="Open DevTools → Application → Cookies">
        Right-click anywhere on the page, choose <em>Inspect</em>, then go to
        the <strong>Application</strong> tab in DevTools. In the left
        sidebar, expand <strong>Cookies</strong> → click{" "}
        <code className="font-mono text-sm">https://www.skool.com</code>.
      </Step>

      <Step n="3" title="Copy two cookie values">
        You&apos;ll see a long list of cookies. Find these two and copy the
        full <em>Value</em> column for each:
        <ul className="ml-6 mt-3 list-disc space-y-1 text-sm">
          <li>
            <code className="font-mono">auth_token</code> — a long JWT
            starting with <code className="font-mono">eyJ…</code>
          </li>
          <li>
            <code className="font-mono">client_id</code> — a 32-character
            hex string
          </li>
        </ul>
      </Step>

      <Step n="4" title="Find your Group ID">
        Stay in DevTools and switch to the <strong>Network</strong> tab.
        Filter by <code className="font-mono">api2.skool.com</code> and click
        around your community for a moment. Any request URL that starts with{" "}
        <code className="font-mono">/groups/</code> contains your group
        ID — the 32-character hex string right after{" "}
        <code className="font-mono">/groups/</code>. Copy that.
      </Step>

      <Step n="5" title="Paste all three back into Settings">
        We&apos;ll verify the cookies live with Skool, encrypt them, and only
        then save. You&apos;ll see a green &ldquo;Connected&rdquo; status when
        it works.
      </Step>

      <hr className="my-12 border-rule" />

      <h2 className="font-display text-2xl">What we do with these</h2>
      <ul className="mt-4 space-y-2 text-sm text-muted">
        <li>
          <strong className="text-ink">Read-only.</strong> We use your session
          to read course completion, member activity, and admin metrics. We
          never post, DM, or edit anything in Skool.
        </li>
        <li>
          <strong className="text-ink">Encrypted at rest.</strong>{" "}
          AES-256-GCM with a server-only key. Plaintext never touches our
          logs.
        </li>
        <li>
          <strong className="text-ink">Revocable.</strong> Settings →
          Disconnect wipes the row. You can also rotate by signing out of
          Skool — that invalidates the session immediately.
        </li>
      </ul>
    </main>
  );
}

function Step({
  n,
  title,
  children,
}: {
  n: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-10">
      <div className="flex items-baseline gap-3">
        <span className="font-display text-3xl text-terracotta">{n}</span>
        <h2 className="font-display text-xl">{title}</h2>
      </div>
      <div className="mt-2 max-w-xl text-sm leading-relaxed text-muted">{children}</div>
    </section>
  );
}
