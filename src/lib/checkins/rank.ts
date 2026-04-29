import type { MemberRiskFlag } from "./at-risk";

// Ranking rule from `creator-wisdom-and-product-decisions.md`,
// Feature 4: "Rank by 'winnability' not just risk — high-tenure
// members deserve more effort than month-1 members."
//
// Day-list cap is 7 names — same source ("creator can't realistically
// DM 50 people").

export const DAILY_CHECK_IN_CAP = 7;

export interface RankableInput {
  flag: MemberRiskFlag;
  completedLessons: number;
  /** Optional revenue signal — preserved from CSV import but not
   *  required. When present it acts as a tie-breaker (higher LTV =
   *  more "winnable"). */
  ltv?: number | null;
}

/**
 * Higher score = DM this person first. The score combines tenure
 * (relationship value) and prior progress (proof they cared). LTV is
 * a final tie-breaker.
 */
export function rankScore(input: RankableInput): number {
  const tenureSignal = Math.min(input.flag.tenureDays, 365);
  const progressSignal = Math.min(input.completedLessons, 50) * 5;
  const ltvSignal = input.ltv !== undefined && input.ltv !== null
    ? Math.min(input.ltv, 5000) / 100
    : 0;
  return tenureSignal + progressSignal + ltvSignal;
}

/** Rank inputs by `rankScore`, descending. Stable: original order
 *  breaks ties so callers get deterministic output. */
export function rankCheckIns<T extends RankableInput>(
  inputs: T[],
  cap: number = DAILY_CHECK_IN_CAP,
): T[] {
  return inputs
    .map((x, i) => ({ x, i, score: rankScore(x) }))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.i - b.i; // stable
    })
    .slice(0, cap)
    .map(({ x }) => x);
}
