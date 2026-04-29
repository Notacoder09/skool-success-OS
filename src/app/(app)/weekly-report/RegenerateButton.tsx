"use client";

import { useState, useTransition } from "react";

import {
  regenerateWeeklyReportNow,
  type RegenerateNowResult,
} from "./actions";

type ToastState =
  | { kind: "idle" }
  | { kind: "success"; message: string }
  | { kind: "error"; message: string };

export function RegenerateWeeklyReportButton() {
  const [toast, setToast] = useState<ToastState>({ kind: "idle" });
  const [isPending, startTransition] = useTransition();

  function run() {
    setToast({ kind: "idle" });
    startTransition(async () => {
      const result = (await regenerateWeeklyReportNow()) as RegenerateNowResult;
      if (!result.ok) {
        setToast({ kind: "error", message: result.error });
        return;
      }
      const parts: string[] = [];
      parts.push(`Built ${result.sectionCount}-section ${result.variant} report`);
      if (result.sent) parts.push("emailed");
      else if (result.reusedExisting) parts.push("already sent this week");
      else parts.push("preview only — not emailed");
      setToast({ kind: "success", message: parts.join(" · ") + "." });
    });
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <button
        type="button"
        onClick={run}
        disabled={isPending}
        className="rounded-lg border border-rule bg-canvas px-3 py-1.5 text-sm font-medium text-ink hover:border-ink/40 disabled:opacity-60"
      >
        {isPending ? "Building…" : "Regenerate this week"}
      </button>
      {toast.kind !== "idle" ? (
        <div
          className={`text-xs ${
            toast.kind === "success" ? "text-forest" : "text-terracotta-ink"
          }`}
        >
          {toast.message}
        </div>
      ) : null}
    </div>
  );
}
