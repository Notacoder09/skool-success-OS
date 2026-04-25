"use client";

import { useState, useTransition } from "react";

import { disconnectSkool } from "./actions";

export function DisconnectButton() {
  const [isPending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="text-sm text-muted underline-offset-4 hover:text-ink hover:underline"
      >
        Disconnect Skool
      </button>
    );
  }
  return (
    <div className="flex items-center gap-3 text-sm">
      <span className="text-ink">Remove your stored Skool session?</span>
      <button
        type="button"
        onClick={() => startTransition(() => disconnectSkool())}
        disabled={isPending}
        className="rounded-lg bg-terracotta px-3 py-1.5 text-canvas hover:bg-terracotta/90 disabled:opacity-60"
      >
        {isPending ? "Removing…" : "Disconnect"}
      </button>
      <button
        type="button"
        onClick={() => setConfirming(false)}
        className="text-muted underline-offset-4 hover:text-ink hover:underline"
      >
        Cancel
      </button>
    </div>
  );
}
