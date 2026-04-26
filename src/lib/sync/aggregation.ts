// Pure aggregation helpers (Day 5).
//
// Owners of the math live here so we can unit-test the rules without a
// database. The orchestrator pulls counts via Drizzle then calls these
// to compute the per-lesson "% of members who completed it".

export interface CompletionCounts {
  /** Members for the community whose progression we have a row for. */
  totalMembers: number;
  /** Members who have completed_at set on this lesson. */
  completed: number;
}

// Returns a percentage 0–100 with 2 decimal places, or null when we
// have no denominator. Honest-by-default: if zero members are tracked
// we leave the lesson cell blank rather than show "0% (of nobody)".
export function computeLessonCompletionPct(
  counts: CompletionCounts,
): number | null {
  if (counts.totalMembers <= 0) return null;
  if (counts.completed < 0) return 0;
  const pct = (counts.completed * 100) / counts.totalMembers;
  // Cap at 100 just in case completed > total (shouldn't happen, but
  // a stale upsert could race; never flash "120%" on the UI).
  return Math.min(100, Math.round(pct * 100) / 100);
}

// Tone bucket used by the V2 mockup colour scale on the Drop-Off Map.
// Centralising the thresholds means the UI and any future AI prompt
// stay aligned with the same definition of "leak vs healthy".
export type CompletionTone = "unknown" | "healthy" | "warm" | "leak";

export function toneForCompletion(pct: number | null): CompletionTone {
  if (pct === null) return "unknown";
  if (pct >= 75) return "healthy";
  if (pct >= 50) return "warm";
  return "leak";
}
