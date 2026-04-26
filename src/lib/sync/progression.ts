import type {
  SkoolMemberCoursePermissionsResponse,
  SkoolUnit,
} from "@/lib/skool-api";

// Pure helpers used by the sync orchestrator's per-member progression
// step. Kept dependency-free (no DB, no Skool client) so they can be
// unit-tested without env vars or the Next.js runtime.

export interface FlatProgressionRow {
  skoolUnitId: string;
  completed: boolean;
  completionPct: number | null;
  completedAt: Date | null;
}

// Walk all units returned for a single member's progression call. Skool
// returns a flat list at this endpoint per recon, but we defensively
// recurse in case nested `children` appear in future responses.
//
// Interpretation rules — derived from the metadata fields seen in recon
// (master plan §"Skool API"):
//   - metadata.user_completed === 1 → completed
//   - metadata.completed === 1      → completed (older field name)
//   - anything else                 → not completed (or unknown)
//
// We only persist hard signals. Skool doesn't expose a per-lesson
// "% watched", so completionPct is either 100 (when completed) or null
// (unknown). We never invent partial percentages.
export function flattenProgressionUnits(
  response: SkoolMemberCoursePermissionsResponse,
): FlatProgressionRow[] {
  const out: FlatProgressionRow[] = [];
  const seen = new Set<string>();

  function walk(unit: SkoolUnit | undefined): void {
    if (!unit?.id || seen.has(unit.id)) return;
    seen.add(unit.id);

    const meta = unit.metadata ?? {};
    const completed = meta.user_completed === 1 || meta.completed === 1;
    const completionPct = completed ? 100 : null;
    let completedAt: Date | null = null;
    if (completed && unit.updated_at) {
      const d = new Date(unit.updated_at);
      if (!Number.isNaN(d.getTime())) completedAt = d;
    }

    out.push({
      skoolUnitId: unit.id,
      completed,
      completionPct,
      completedAt,
    });

    const children = (unit as SkoolUnit & { children?: SkoolUnit[] }).children;
    if (Array.isArray(children)) {
      for (const child of children) walk(child);
    }
  }

  for (const u of response.courses ?? []) walk(u);
  return out;
}

export interface ProgressionWarning {
  step: "get_member_progression";
  message: string;
  detail: { memberId: string; skoolMemberId: string };
}

export interface ProgressionSyncResult {
  apiCalls: number;
  upserted: number;
  membersAttempted: number;
  membersSucceeded: number;
  warnings: ProgressionWarning[];
}
