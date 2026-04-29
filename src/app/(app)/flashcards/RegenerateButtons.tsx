"use client";

import { useState, useTransition } from "react";

import {
  dispatchSendsNow,
  regenerateAllSources,
  type DispatchNowResult,
  type RegenerateAllResult,
} from "./actions";

type ToastState =
  | { kind: "idle" }
  | { kind: "success"; message: string }
  | { kind: "error"; message: string };

export function RegenerateAllButton() {
  const [toast, setToast] = useState<ToastState>({ kind: "idle" });
  const [isPending, startTransition] = useTransition();

  function run() {
    setToast({ kind: "idle" });
    startTransition(async () => {
      const result = (await regenerateAllSources()) as RegenerateAllResult;
      if (!result.ok) {
        setToast({ kind: "error", message: result.error });
        return;
      }
      setToast({
        kind: "success",
        message: `Scanned ${result.processed} lessons — ${result.generated} ready, ${result.skipped} skipped, ${result.deferred} pending Whisper.`,
      });
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
        {isPending ? "Scanning…" : "Re-scan all lessons"}
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

export function DispatchSendsButton() {
  const [toast, setToast] = useState<ToastState>({ kind: "idle" });
  const [isPending, startTransition] = useTransition();

  function run() {
    setToast({ kind: "idle" });
    startTransition(async () => {
      const result = (await dispatchSendsNow()) as DispatchNowResult;
      if (!result.ok) {
        setToast({ kind: "error", message: result.error });
        return;
      }
      const parts: string[] = [];
      parts.push(
        `Considered ${result.considered} completion${result.considered === 1 ? "" : "s"}`,
      );
      if (result.sent > 0) parts.push(`sent ${result.sent}`);
      if (result.alreadySent > 0) parts.push(`already sent ${result.alreadySent}`);
      if (result.skippedNoCards > 0)
        parts.push(`${result.skippedNoCards} pending card generation`);
      if (result.skippedNoEmail > 0)
        parts.push(`${result.skippedNoEmail} no email on file`);
      if (result.failed > 0) parts.push(`${result.failed} failed`);
      setToast({ kind: "success", message: parts.join(" · ") + "." });
    });
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <button
        type="button"
        onClick={run}
        disabled={isPending}
        className="rounded-lg bg-ink px-3 py-1.5 text-sm font-medium text-canvas hover:bg-ink/90 disabled:opacity-60"
      >
        {isPending ? "Dispatching…" : "Send due now"}
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
