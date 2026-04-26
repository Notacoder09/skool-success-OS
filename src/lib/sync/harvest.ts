// Pure helpers for member-ID harvesting (Day 5).
//
// Skool deliberately hides the member list from owners (master plan
// Part 4 — confirmed dead end on /members). The three workarounds are:
//   1. Creator-uploaded CSV (ADR-0004) — deterministic, always works.
//   2. Harvesting IDs from analytics endpoints — best-effort, this file.
//   3. v2 Chrome extension — captures IDs as creator browses.
//
// Strategy here: when we hit /analytics-overview-v2 or
// /analytics-growth-overview-v2 we get back arbitrary JSON whose shape
// we don't control. Walk the response, collect all 32-char hex strings
// (Skool's UUID format is hex-without-dashes), then strip out IDs we
// already know are *not* members (creator's user_id, course IDs,
// lesson IDs, the group ID itself). What's left are candidate member
// IDs we mark with `source='harvest'` and try to pull progression for.
//
// Wrong by design? Yes — false positives are possible. They get
// filtered out the first time we call getMemberProgression and Skool
// 404s; we keep the row as dormant rather than aggressively delete,
// since a future call might confirm membership (Skool de-syncs
// occasionally).

const SKOOL_UUID_RE = /^[a-f0-9]{32}$/;

export interface HarvestOptions {
  /** Don't return these IDs (creator, group, courses, lessons). */
  exclude: ReadonlySet<string>;
}

// Recursively collect every Skool-shaped UUID found in the value. Strings
// are tested with the regex; objects/arrays are walked. Cycles are
// ignored via a WeakSet to be safe against future shapes.
export function harvestSkoolUuids(
  value: unknown,
  opts: HarvestOptions,
): string[] {
  const found = new Set<string>();
  const visited = new WeakSet<object>();

  function walk(node: unknown): void {
    if (node === null || node === undefined) return;
    if (typeof node === "string") {
      if (SKOOL_UUID_RE.test(node) && !opts.exclude.has(node)) {
        found.add(node);
      }
      return;
    }
    if (typeof node !== "object") return;
    if (visited.has(node as object)) return;
    visited.add(node as object);

    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    for (const value of Object.values(node as Record<string, unknown>)) {
      walk(value);
    }
  }

  walk(value);
  return Array.from(found);
}

// True if a string looks like a Skool UUID. Exposed for callers that
// want to gate other logic on the same shape.
export function isSkoolUuid(s: string): boolean {
  return SKOOL_UUID_RE.test(s);
}
