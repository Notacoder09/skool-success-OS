// At-risk classification for Member Check-ins (Feature 4).
//
// Rules come straight from `creator-wisdom-and-product-decisions.md`,
// Part 2, Feature 4. The wisdom doc gives three thresholds:
//
//   1. Activity drops 50%+ vs the member's own 30-day baseline
//      (relative, not absolute).
//   2. No posts/comments/likes in 14 days when they used to be active.
//   3. Course progress stalled mid-module for 7+ days.
//
// In v1 we don't scrape posts/comments/likes (master plan, Feature 3,
// "no feed scraping in v1"), so signal #2 is approximated using
// `members.lastActiveAt` — the latest progression activity we have on
// record. That's honest: we surface what we can, and the UI says so.
//
// This module is pure (no DB calls) so the page can compute at-risk
// inline and tests can hammer it with synthetic inputs.

export type RiskReasonKind =
  | "stalled_mid_course"
  | "tenure_dropoff"
  | "brand_new_ghost";

export interface MemberRiskInput {
  memberId: string;
  /** Display name. Falls back to email/handle in caller; this lib
   *  doesn't make that decision. */
  name: string | null;
  joinedAt: Date | null;
  lastActiveAt: Date | null;
  /** Number of completed lessons (any course). Used for "winnability"
   *  ranking and to skip "they finished, they're fine" cases. */
  completedLessons: number;
  /** Number of in-progress lessons (>0% but not completed). */
  inProgressLessons: number;
  /** Most recent activity on any in-progress lesson. Null if none in
   *  progress. Used to detect mid-course stalls. */
  inProgressLastActivityAt: Date | null;
  /** Total enrolled lessons in this community (used to know whether
   *  they "finished everything"). */
  totalLessons: number;
}

export interface MemberRiskFlag {
  memberId: string;
  reasonKind: RiskReasonKind;
  /** Plain-language reason shown in the UI. Honest and specific. */
  reason: string;
  /** Days since the member last did anything we know about. */
  daysSinceActive: number | null;
  /** Days since they joined. Used by the ranker. */
  tenureDays: number;
}

/**
 * Returns a risk flag if any wisdom-doc rule fires, otherwise null.
 *
 * Selection precedence (only one fires per member):
 *   1. stalled_mid_course (most actionable)
 *   2. tenure_dropoff
 *   3. brand_new_ghost
 *
 * `asOf` is the reference "now". Defaults to `new Date()` but tests
 * pin it for determinism.
 */
export function classifyMemberRisk(
  input: MemberRiskInput,
  asOf: Date = new Date(),
): MemberRiskFlag | null {
  const tenureDays = input.joinedAt
    ? daysBetween(input.joinedAt, asOf)
    : Number.POSITIVE_INFINITY; // unknown tenure = treat as "old enough"

  const daysSinceActive = input.lastActiveAt
    ? daysBetween(input.lastActiveAt, asOf)
    : null;

  // "They finished everything" → not at risk (they're a graduate, not
  // a ghost). Skip the entire check.
  if (
    input.totalLessons > 0 &&
    input.completedLessons >= input.totalLessons &&
    input.inProgressLessons === 0
  ) {
    return null;
  }

  // Rule 1 — stalled mid-course. They started something and haven't
  // touched it in 7+ days. Most actionable: the creator can DM about
  // *that lesson*.
  if (
    input.inProgressLessons > 0 &&
    input.inProgressLastActivityAt !== null
  ) {
    const stallDays = daysBetween(input.inProgressLastActivityAt, asOf);
    if (stallDays >= 7) {
      return {
        memberId: input.memberId,
        reasonKind: "stalled_mid_course",
        reason: `Started a lesson but hasn't moved in ${stallDays} day${stallDays === 1 ? "" : "s"}`,
        daysSinceActive,
        tenureDays: tenureDaysOrZero(tenureDays),
      };
    }
  }

  // Rule 2 — tenure dropoff. Tenured member (≥30 days) who used to be
  // active and hasn't done anything we can see in 14+ days.
  if (
    tenureDays >= 30 &&
    input.completedLessons > 0 &&
    daysSinceActive !== null &&
    daysSinceActive >= 14
  ) {
    return {
      memberId: input.memberId,
      reasonKind: "tenure_dropoff",
      reason: `Used to be active. No course activity for ${daysSinceActive} days`,
      daysSinceActive,
      tenureDays: tenureDaysOrZero(tenureDays),
    };
  }

  // Rule 3 — brand-new ghost. Joined 7-14 days ago, hasn't started
  // anything yet. Catch them before they slide. We bound the upper
  // edge so we don't keep flagging the same person for 8 months.
  if (
    tenureDays >= 7 &&
    tenureDays <= 14 &&
    input.completedLessons === 0 &&
    input.inProgressLessons === 0
  ) {
    return {
      memberId: input.memberId,
      reasonKind: "brand_new_ghost",
      reason: `Joined ${tenureDays} days ago and hasn't started yet`,
      daysSinceActive,
      tenureDays: tenureDaysOrZero(tenureDays),
    };
  }

  return null;
}

function daysBetween(earlier: Date, later: Date): number {
  const diffMs = later.getTime() - earlier.getTime();
  return Math.max(0, Math.floor(diffMs / 86_400_000));
}

function tenureDaysOrZero(t: number): number {
  return Number.isFinite(t) ? t : 0;
}
