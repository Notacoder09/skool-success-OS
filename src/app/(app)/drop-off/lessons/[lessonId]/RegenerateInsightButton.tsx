"use client";

import { useTransition, useState } from "react";

import { regenerateInsightForLesson } from "./actions";

export function RegenerateInsightButton({ lessonId }: { lessonId: string }) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [tone, setTone] = useState<"ok" | "warn" | null>(null);

  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          setMessage(null);
          setTone(null);
          startTransition(async () => {
            const r = await regenerateInsightForLesson(lessonId);
            if (r.ok) {
              setTone("ok");
              setMessage(
                r.usedFallback
                  ? "Regenerated with rule-based fallback."
                  : "Regenerated.",
              );
            } else {
              setTone("warn");
              setMessage(r.message);
            }
          });
        }}
        className="rounded-lg border border-rule bg-canvas px-3 py-1.5 text-xs text-ink hover:bg-cream/60 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {pending ? "Regenerating…" : "Regenerate insight"}
      </button>
      {message ? (
        <span
          className={`text-xs ${
            tone === "ok" ? "text-forest" : "text-terracotta-ink"
          }`}
        >
          {message}
        </span>
      ) : null}
    </div>
  );
}
