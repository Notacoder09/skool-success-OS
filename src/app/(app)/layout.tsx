import { redirect } from "next/navigation";

import { SidebarNav } from "@/components/SidebarNav";
import { TimezoneCapture } from "@/components/TimezoneCapture";
import { getCurrentCreator, getPrimaryCommunity } from "@/lib/server/creator";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const creator = await getCurrentCreator();
  if (!creator) redirect("/sign-in");

  const community = await getPrimaryCommunity(creator.creatorId);
  const connected = community
    ? {
        name: community.name ?? "Your community",
        synced: community.lastSyncedAt !== null,
        lastSyncedLabel: community.lastSyncedAt
          ? `synced ${formatRelative(community.lastSyncedAt)}`
          : "not synced yet",
      }
    : null;

  return (
    <div className="flex min-h-screen bg-canvas">
      <SidebarNav connectedCommunity={connected} />
      <main className="flex-1 px-12 py-10">{children}</main>
      <TimezoneCapture initial={creator.timezone} />
    </div>
  );
}

function formatRelative(d: Date): string {
  const diffMs = Date.now() - d.getTime();
  const minutes = Math.round(diffMs / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}
