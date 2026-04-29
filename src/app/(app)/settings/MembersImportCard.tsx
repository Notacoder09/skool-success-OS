"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { importMembersFromCsv, type ImportMembersResult } from "./actions";

type Status =
  | { kind: "idle" }
  | { kind: "ok"; result: Extract<ImportMembersResult, { ok: true }> }
  | { kind: "error"; message: string };

export function MembersImportCard({
  currentMemberCount,
  membersWithSkoolId,
}: {
  currentMemberCount: number;
  membersWithSkoolId: number;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [chosenName, setChosenName] = useState<string | null>(null);
  const router = useRouter();

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    setChosenName(file?.name ?? null);
    setStatus({ kind: "idle" });
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const file = fileInputRef.current?.files?.[0];
    if (!file) {
      setStatus({ kind: "error", message: "Pick a CSV file first." });
      return;
    }
    const fd = new FormData();
    fd.set("file", file);
    startTransition(async () => {
      try {
        const res = await importMembersFromCsv(fd);
        if (res.ok) {
          setStatus({ kind: "ok", result: res });
          router.refresh();
        } else {
          setStatus({ kind: "error", message: res.error });
        }
      } catch (err) {
        setStatus({
          kind: "error",
          message: err instanceof Error ? err.message : "Import failed.",
        });
      }
    });
  }

  return (
    <div>
      <div className="mb-3 flex items-baseline gap-2 text-sm">
        <span className="text-ink">
          <strong>{currentMemberCount}</strong>{" "}
          {currentMemberCount === 1 ? "member" : "members"} in this community
        </span>
        <span className="text-muted">·</span>
        <span className="text-muted">
          {membersWithSkoolId} ready for progression sync
        </span>
      </div>

      <form onSubmit={onSubmit} className="space-y-3">
        <label className="block">
          <span className="text-xs uppercase tracking-[0.18em] text-muted">
            CSV file
          </span>
          <div className="mt-2 flex items-center gap-3">
            <input
              ref={fileInputRef}
              type="file"
              name="file"
              accept=".csv,text/csv"
              onChange={onFileChange}
              disabled={pending}
              className="block w-full max-w-sm cursor-pointer rounded-md border border-rule bg-canvas px-3 py-2 text-sm file:mr-3 file:rounded file:border-0 file:bg-cream file:px-3 file:py-1 file:text-xs file:font-medium hover:border-ink/30 disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={pending}
              className="rounded-lg bg-ink px-4 py-2 text-sm text-canvas hover:bg-ink/90 disabled:opacity-50"
            >
              {pending ? "Importing…" : "Import"}
            </button>
          </div>
          {chosenName ? (
            <span className="mt-1 block text-xs text-muted">
              Selected: <span className="font-mono">{chosenName}</span>
            </span>
          ) : null}
        </label>

        <p className="max-w-2xl text-xs leading-relaxed text-muted">
          Export from Skool: Admin → Members → Export. We read{" "}
          <span className="font-mono">FirstName</span>,{" "}
          <span className="font-mono">LastName</span>,{" "}
          <span className="font-mono">Email</span>,{" "}
          <span className="font-mono">JoinedDate</span>,{" "}
          <span className="font-mono">Tier</span>, and{" "}
          <span className="font-mono">LTV</span>. Email is optional —
          members without one still get imported and matched against your
          Skool data on the next sync. Question/Answer/Price columns are
          ignored.
        </p>

        <ResultPanel status={status} />
      </form>
    </div>
  );
}

function ResultPanel({ status }: { status: Status }) {
  if (status.kind === "idle") return null;
  if (status.kind === "error") {
    return (
      <div className="rounded-md border border-terracotta/40 bg-terracotta-soft/40 px-3 py-2 text-xs text-terracotta-ink">
        {status.message}
      </div>
    );
  }
  const r = status.result;
  // Headline copy as requested by the creator on 2026-04-27. The
  // detail line is a small expansion of the same fact for cases
  // where the totals don't match (rejected rows, enrichment, etc.).
  return (
    <div className="rounded-md border border-forest/40 bg-forest-soft px-3 py-2 text-xs text-ink">
      <div>
        Imported <strong>{r.importedCount}</strong>{" "}
        {r.importedCount === 1 ? "member" : "members"}. We&apos;ll match
        them to your Skool data on the next sync.
      </div>
      {r.updated > 0 ||
      r.enrichedWithSkoolId > 0 ||
      r.rejectedRows > 0 ? (
        <div className="mt-0.5 text-muted">
          {r.inserted} new
          {r.updated > 0 ? ` · ${r.updated} updated` : ""}
          {r.enrichedWithSkoolId > 0
            ? ` · ${r.enrichedWithSkoolId} enriched with Skool ID`
            : ""}
          {r.rejectedRows > 0
            ? ` · ${r.rejectedRows} ${r.rejectedRows === 1 ? "row" : "rows"} skipped`
            : ""}
          .
        </div>
      ) : null}
    </div>
  );
}
