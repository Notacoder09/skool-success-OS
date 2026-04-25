"use client";

import { useState, useTransition } from "react";

import { setTranscriptionEnabled } from "./actions";

export function TranscriptionToggle({
  initial,
  quotaMinutes,
}: {
  initial: boolean;
  quotaMinutes: number;
}) {
  const [enabled, setEnabled] = useState(initial);
  const [isPending, startTransition] = useTransition();

  function toggle() {
    const next = !enabled;
    setEnabled(next);
    startTransition(async () => {
      await setTranscriptionEnabled(next);
    });
  }

  return (
    <div className="flex items-start justify-between gap-6">
      <div>
        <div className="text-sm font-medium text-ink">
          Auto-transcribe video lessons
        </div>
        <p className="mt-1 max-w-md text-sm text-muted">
          Off by default. When on, we use OpenAI Whisper to read videos for
          flashcard generation only when no description, PDF, or cached
          transcript is available — and only up to your monthly quota
          ({quotaMinutes} minutes). Transcripts are cached forever; re-use
          is free.
        </p>
      </div>
      <button
        type="button"
        onClick={toggle}
        disabled={isPending}
        aria-pressed={enabled}
        className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition ${
          enabled ? "bg-forest" : "bg-rule"
        } ${isPending ? "opacity-60" : ""}`}
      >
        <span
          className={`inline-block h-5 w-5 transform rounded-full bg-canvas shadow transition ${
            enabled ? "translate-x-5" : "translate-x-0.5"
          }`}
        />
        <span className="sr-only">{enabled ? "On" : "Off"}</span>
      </button>
    </div>
  );
}
