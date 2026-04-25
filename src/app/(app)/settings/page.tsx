import { redirect } from "next/navigation";

import {
  getCurrentCreator,
  getPrimaryCommunity,
  getSkoolConnection,
} from "@/lib/server/creator";

import { DisconnectButton } from "./DisconnectButton";
import { SkoolConnectForm } from "./SkoolConnectForm";
import { TranscriptionToggle } from "./TranscriptionToggle";

export default async function SettingsPage() {
  const creator = await getCurrentCreator();
  if (!creator) redirect("/sign-in");

  const [connection, community] = await Promise.all([
    getSkoolConnection(creator.creatorId),
    getPrimaryCommunity(creator.creatorId),
  ]);

  return (
    <div className="max-w-3xl">
      <header>
        <p className="text-xs uppercase tracking-[0.18em] text-muted">Settings</p>
        <h1 className="mt-2 font-display text-4xl">Your setup.</h1>
        <p className="mt-2 text-base text-muted">
          Three small things to set up. Once they&apos;re in place, everything
          else runs in the background.
        </p>
      </header>

      <Section
        kicker="01"
        title="Skool connection"
        description="We use your own logged-in Skool session to read your community data. Cookies are encrypted at rest (AES-256-GCM) and you can revoke access any time."
      >
        {connection.connected ? (
          <ConnectedCard
            communityName={community?.name ?? null}
            lastVerifiedAt={connection.lastVerifiedAt}
          />
        ) : (
          <SkoolConnectForm />
        )}
      </Section>

      <Section
        kicker="02"
        title="Flashcards"
        description="Default ON for your members. The behaviour below controls only the auto-transcription fallback that turns video-only lessons into flashcards."
      >
        <TranscriptionToggle
          initial={creator.transcriptionEnabled}
          quotaMinutes={creator.transcriptionMinutesQuota}
        />
      </Section>

      <Section
        kicker="03"
        title="Schedule"
        description="Your weekly optimization report lands Monday 7 AM in your local time. Detected from your browser; change here if needed."
      >
        <div className="text-sm">
          <span className="text-muted">Detected timezone:</span>{" "}
          <span className="font-mono text-ink">{creator.timezone}</span>
          <div className="mt-2 text-xs text-muted">
            Manual override coming soon. If this looks wrong, sign in from the
            browser/device you&apos;ll be using most.
          </div>
        </div>
      </Section>
    </div>
  );
}

function Section({
  kicker,
  title,
  description,
  children,
}: {
  kicker: string;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-10 rounded-card border border-rule bg-canvas px-6 py-6">
      <div className="flex items-baseline gap-3">
        <span className="text-xs uppercase tracking-[0.18em] text-muted">{kicker}</span>
        <h2 className="font-display text-2xl">{title}</h2>
      </div>
      <p className="mt-2 max-w-2xl text-sm text-muted">{description}</p>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function ConnectedCard({
  communityName,
  lastVerifiedAt,
}: {
  communityName: string | null;
  lastVerifiedAt: Date | null;
}) {
  return (
    <div className="flex items-start justify-between gap-6">
      <div>
        <div className="flex items-center gap-2 text-sm font-medium text-ink">
          <span className="inline-block h-2 w-2 rounded-full bg-forest" />
          Connected{communityName ? ` — ${communityName}` : ""}
        </div>
        <div className="mt-1 text-xs text-muted">
          Last verified{" "}
          {lastVerifiedAt
            ? lastVerifiedAt.toLocaleString()
            : "—"}
        </div>
      </div>
      <DisconnectButton />
    </div>
  );
}
