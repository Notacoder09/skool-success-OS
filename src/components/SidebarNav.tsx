"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { Logo } from "./Logo";

// Sidebar nav matches the locked V2 mockup. Order, grouping, and labels
// come straight from docs/mockups/01-today.png. Do not reorder or rename
// without updating the mockup first.

type NavItem = {
  label: string;
  href: `/${string}`;
  comingSoon?: boolean;
};

type NavGroup = {
  heading?: string;
  items: NavItem[];
};

const NAV: NavGroup[] = [
  {
    items: [{ label: "Today", href: "/today" }],
  },
  {
    heading: "Retention",
    items: [
      { label: "Drop-Off Map", href: "/drop-off" },
      { label: "Member Check-ins", href: "/check-ins" },
    ],
  },
  {
    heading: "Learning",
    items: [{ label: "Flashcards", href: "/flashcards" }],
  },
  {
    heading: "Community",
    items: [
      { label: "Pulse", href: "/pulse" },
      { label: "Weekly Report", href: "/weekly-report" },
    ],
  },
  // The mockup keeps the chrome minimal (no Settings in the sidebar at
  // all), but in the real product the creator needs a way back to
  // Settings to swap communities or re-upload a CSV. Keep it in its own
  // group at the bottom so it doesn't compete with the V1 features.
  {
    heading: "Account",
    items: [{ label: "Settings", href: "/settings" }],
  },
];

export function SidebarNav({
  connectedCommunity,
}: {
  connectedCommunity: {
    name: string;
    lastSyncedLabel: string;
    synced: boolean;
  } | null;
}) {
  const pathname = usePathname() ?? "";

  return (
    <aside className="flex h-full w-64 shrink-0 flex-col border-r border-rule bg-canvas">
      <div className="px-6 pb-8 pt-6">
        <Link href="/today" aria-label="CourseSuccess">
          <Logo />
        </Link>
      </div>

      <nav className="flex-1 px-3">
        {NAV.map((group, gi) => (
          <div key={gi} className="mb-6">
            {group.heading ? (
              <div className="px-3 pb-2 text-[11px] uppercase tracking-[0.16em] text-muted">
                {group.heading}
              </div>
            ) : null}
            <ul className="space-y-0.5">
              {group.items.map((item) => {
                const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition ${
                        active
                          ? "bg-cream text-terracotta-ink"
                          : "text-ink hover:bg-cream/60"
                      }`}
                    >
                      <span
                        aria-hidden
                        className={`inline-block h-1.5 w-1.5 rounded-full ${
                          active ? "bg-terracotta" : "bg-rule"
                        }`}
                      />
                      <span>{item.label}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      <Link
        href="/settings"
        className="mx-4 mb-4 block rounded-card border border-rule bg-canvas px-4 py-3 transition hover:border-terracotta/40 hover:bg-cream/40"
        aria-label={
          connectedCommunity
            ? "Open Settings to manage community or re-upload member CSV"
            : "Connect Skool in Settings"
        }
      >
        <div className="flex items-baseline justify-between">
          <div className="text-[11px] uppercase tracking-[0.16em] text-muted">
            Connected community
          </div>
          <span className="text-[11px] text-muted/70">Manage →</span>
        </div>
        <div className="mt-1.5 text-sm font-medium text-ink">
          {connectedCommunity ? connectedCommunity.name : "Not connected"}
        </div>
        <div className="mt-0.5 text-xs text-muted">
          {connectedCommunity ? (
            <>
              <span
                aria-hidden
                className={`mr-1.5 inline-block h-1.5 w-1.5 rounded-full align-middle ${
                  connectedCommunity.synced ? "bg-forest" : "bg-rule"
                }`}
              />
              {connectedCommunity.lastSyncedLabel}
            </>
          ) : (
            <span className="text-terracotta-ink">Connect Skool →</span>
          )}
        </div>
      </Link>
    </aside>
  );
}
