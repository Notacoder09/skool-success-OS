"use client";

import { useState, useTransition } from "react";

import type { DraftTone } from "@/lib/checkins";
import { TONE_DESCRIPTIONS, TONE_LABELS, TONES } from "@/lib/checkins";

import { recordCheckInDraft } from "./actions";

// Day 8-10 — "Draft Message" button cluster.
//
// Wisdom doc: "v1: Copy to clipboard + open Skool DM tab. Honest
// disclosure: 'Skool doesn't allow us to send DMs directly yet. One
// click to copy, one click to paste in Skool.'"
//
// We open a new tab to the creator's Skool inbox URL. We don't have a
// confirmed "DM this specific member" deeplink (Skool doesn't expose
// one), so the inbox is the closest honest landing.

interface DraftMessageButtonProps {
  memberId: string;
  /** Pre-rendered draft text per tone. Computed server-side so we
   *  don't ship the templates to the client more than once. */
  drafts: Record<DraftTone, string>;
  /** Where to open the Skool DM tab. Falls back to the inbox URL. */
  skoolDmUrl: string;
  /** True once the creator has copied this member today (drives the
   *  "Drafted today" pill). */
  alreadyDraftedToday: boolean;
}

type CopyState = "idle" | "copied" | "error";

export function DraftMessageButton({
  memberId,
  drafts,
  skoolDmUrl,
  alreadyDraftedToday,
}: DraftMessageButtonProps) {
  const [open, setOpen] = useState(false);
  const [tone, setTone] = useState<DraftTone>("sam");
  const [copyState, setCopyState] = useState<CopyState>("idle");
  const [pending, startTransition] = useTransition();

  const draft = drafts[tone];

  const onPick = (next: DraftTone) => {
    setTone(next);
    setCopyState("idle");
  };

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(draft);
      setCopyState("copied");
    } catch {
      setCopyState("error");
      return;
    }
    // Best-effort: open Skool inbox in a new tab so the creator can
    // paste. We don't await this — the click already happened, and
    // popup blockers will quietly ignore non-user-initiated opens.
    window.open(skoolDmUrl, "_blank", "noopener,noreferrer");
    startTransition(() => {
      void recordCheckInDraft({
        memberId,
        tone,
        draftedMessage: draft,
      });
    });
  };

  return (
    <div className="flex flex-col items-end gap-2">
      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="rounded-lg bg-ink px-3 py-1.5 text-xs font-medium text-canvas hover:bg-ink/90"
        >
          Draft message
        </button>
      ) : (
        <div className="flex w-full max-w-md flex-col gap-2 rounded-card border border-rule bg-canvas p-3">
          <div className="text-[11px] uppercase tracking-[0.16em] text-muted">
            Pick a tone
          </div>
          <div className="flex flex-wrap gap-1.5">
            {TONES.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => onPick(t)}
                className={`rounded-md border px-2 py-1 text-xs ${
                  t === tone
                    ? "border-terracotta bg-cream text-terracotta-ink"
                    : "border-rule bg-canvas text-ink hover:bg-cream/40"
                }`}
                title={TONE_DESCRIPTIONS[t]}
              >
                {TONE_LABELS[t]}
              </button>
            ))}
          </div>
          <pre className="mt-1 whitespace-pre-wrap rounded-md border border-rule bg-cream/40 p-2 text-xs leading-relaxed text-ink">
            {draft}
          </pre>
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] text-muted">
              {copyState === "copied"
                ? pending
                  ? "Copied — saving..."
                  : "Copied. Skool tab opened — paste and send."
                : copyState === "error"
                  ? "Couldn't copy — select the text manually."
                  : alreadyDraftedToday
                    ? "Drafted today already."
                    : "Skool doesn't allow direct sends. One click copies, one paste sends."}
            </span>
            <div className="flex gap-1.5">
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  setCopyState("idle");
                }}
                className="rounded-md border border-rule px-2 py-1 text-xs text-muted hover:bg-cream/40"
              >
                Close
              </button>
              <button
                type="button"
                onClick={onCopy}
                disabled={pending}
                className="rounded-md bg-ink px-3 py-1 text-xs font-medium text-canvas hover:bg-ink/90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {pending ? "Saving…" : "Copy + open Skool"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
