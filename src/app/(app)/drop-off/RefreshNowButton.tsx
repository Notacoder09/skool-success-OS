"use client";

import { useState, useTransition } from "react";

import { refreshNow } from "./actions";

// Manual sync button. Lives at the top of /drop-off. Disabled while
// the action is in flight; surfaces success/throttle/error inline so
// the creator never has to wonder if the click did anything.

export function RefreshNowButton({ disabled = false }: { disabled?: boolean }) {
  const [pending, start] = useTransition();
  const [feedback, setFeedback] = useState<{
    tone: "success" | "warn" | "error";
    text: string;
  } | null>(null);

  async function onClick() {
    setFeedback(null);
    start(async () => {
      const result = await refreshNow();
      if (result.ok) {
        setFeedback({ tone: "success", text: result.message });
      } else if (result.reason === "throttled" || result.reason === "running") {
        setFeedback({ tone: "warn", text: result.message });
      } else {
        setFeedback({ tone: "error", text: result.message });
      }
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={onClick}
        disabled={disabled || pending}
        className="rounded-lg border border-rule bg-canvas px-3 py-1.5 text-xs font-medium text-ink transition hover:bg-cream disabled:cursor-not-allowed disabled:opacity-50"
      >
        {pending ? "Syncing…" : "Refresh now"}
      </button>
      {feedback ? (
        <span
          className={`text-[11px] ${
            feedback.tone === "success"
              ? "text-forest"
              : feedback.tone === "warn"
                ? "text-muted"
                : "text-terracotta-ink"
          }`}
        >
          {feedback.text}
        </span>
      ) : null}
    </div>
  );
}
