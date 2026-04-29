// Day 7 — "main leak" detection.
//
// Day 5/6 surfaced the worst-completion lesson per course. That answers
// the question "where do members end up stuck?" but it's the wrong
// answer to "what should I fix first?". The V2 mockup phrasing is
// "Main leak: L2 → L3" — the *transition* where the cliff happens —
// because that's the lesson edit a creator can actually act on.
//
// The wisdom doc backs this up: drop-off is rarely "the lesson is bad",
// it's "the jump in effort from the previous one was too steep". So
// the metric we want is the transition with the largest negative
// delta in completion %, not the lowest absolute %.
//
// This module is pure (no DB) so the page can call it on the lesson
// rows it already loaded.

export interface CliffLesson {
  id: string;
  position: number;
  title: string;
  completionPct: number | null;
}

export interface Cliff {
  /** Lesson immediately before the drop. Higher completion %. */
  from: CliffLesson;
  /** Lesson where members stall. Lower completion %. */
  to: CliffLesson;
  /** Positive number = points dropped from `from` to `to`. */
  delta: number;
}

// Selection rules, in order:
//
// 1. Among transitions whose *destination* lands in the "leak" zone
//    (< 50% completion per the wisdom-doc threshold), pick the one
//    with the largest drop. This matches the V2 mockup phrasing:
//    when L1=100, L2=66, L3=33, the meaningful leak is L2→L3 (66→33,
//    crosses into the leak zone) even though L1→L2 has a slightly
//    larger absolute delta.
// 2. Otherwise, pick the largest drop overall.
// 3. Returns null when fewer than 2 lessons, no two consecutive
//    lessons both have completion data, or every transition is flat
//    or upward.
//
// Tie-break in either tier: earlier transition wins (wisdom-doc
// "early drops matter more — members who stall early never come back").
export function findLargestCliff(lessons: CliffLesson[]): Cliff | null {
  if (lessons.length < 2) return null;

  const ordered = [...lessons].sort((a, b) => a.position - b.position);

  let bestInLeakZone: Cliff | null = null;
  let bestOverall: Cliff | null = null;

  for (let i = 1; i < ordered.length; i += 1) {
    const a = ordered[i - 1];
    const b = ordered[i];
    if (!a || !b) continue;
    if (a.completionPct === null || b.completionPct === null) continue;
    const delta = a.completionPct - b.completionPct;
    if (delta <= 0) continue;

    if (!bestOverall || delta > bestOverall.delta) {
      bestOverall = { from: a, to: b, delta };
    }
    if (b.completionPct < 50) {
      if (!bestInLeakZone || delta > bestInLeakZone.delta) {
        bestInLeakZone = { from: a, to: b, delta };
      }
    }
  }
  return bestInLeakZone ?? bestOverall;
}

// Convenience for UI: format a cliff as "L2 → L3 (66% → 33%)".
// Returns null when no cliff exists so the caller can choose
// fallback phrasing ("no clear leak").
export function formatCliff(cliff: Cliff | null): string | null {
  if (!cliff) return null;
  const fromPct = Math.round(cliff.from.completionPct ?? 0);
  const toPct = Math.round(cliff.to.completionPct ?? 0);
  return `L${cliff.from.position} → L${cliff.to.position} (${fromPct}% → ${toPct}%)`;
}
