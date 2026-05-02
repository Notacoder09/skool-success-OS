import type {
  SkoolCourseTree,
  SkoolMemberCoursePermissionsResponse,
  SkoolUnit,
  SkoolUnitMetadata,
} from "@/lib/skool-api";

// Pure helpers used by the sync orchestrator's per-member progression
// step. Kept dependency-free (no DB, no Skool client) so they can be
// unit-tested without env vars or the Next.js runtime.

export interface FlatProgressionRow {
  skoolUnitId: string;
  completed: boolean;
  completionPct: number | null;
  completedAt: Date | null;
  /** Best-effort activity time for this unit (Skool `updated_at`), including partial progress */
  lastActivityAt: Date | null;
}

function isCourseTreeNode(val: unknown): val is SkoolCourseTree {
  if (val === null || typeof val !== "object") return false;
  if (!("course" in val)) return false;
  const c = (val as SkoolCourseTree).course;
  return typeof c === "object" && c !== null && typeof c.id === "string";
}

function truthyCompleted(val: unknown): boolean {
  return val === 1 || val === true || val === "1";
}

/** Normalise a Skool metadata progress value to 0–100, or null if absent/invalid */
function normaliseProgressFraction(raw: unknown): number | null {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return null;
  if (raw > 0 && raw <= 1) return Math.round(raw * 10_000) / 100;
  if (raw > 1 && raw <= 100) return Math.round(raw * 100) / 100;
  if (raw === 0) return 0;
  return null;
}

/**
 * Derive completion flag + % from Skool unit metadata. Completed lessons
 * are 100%; partial uses explicit progress fields when present.
 */
export function progressFromMetadata(meta: SkoolUnitMetadata | undefined): {
  completed: boolean;
  completionPct: number | null;
} {
  if (!meta) return { completed: false, completionPct: null };

  const completed =
    truthyCompleted(meta.user_completed) || truthyCompleted(meta.completed);
  if (completed) return { completed: true, completionPct: 100 };

  const pct =
    normaliseProgressFraction(meta.progress) ??
    normaliseProgressFraction(meta.watch_progress) ??
    normaliseProgressFraction(meta.completion_progress) ??
    normaliseProgressFraction(meta.percent_complete) ??
    normaliseProgressFraction(meta.video_progress);

  if (pct !== null && pct > 0) return { completed: false, completionPct: pct };

  return { completed: false, completionPct: null };
}

function parseActivityDate(updatedAt: string | undefined): Date | null {
  if (!updatedAt) return null;
  const d = new Date(updatedAt);
  return Number.isNaN(d.getTime()) ? null : d;
}

// Walk all units returned for a single member's progression call. Skool's
// course tree uses `{ course, children }` (see `SkoolCourseTree` and
// `flattenTreeForLessons`). The progression endpoint returns the same
// nesting; treating `children` as raw `SkoolUnit[]` skips every nested
// lesson because `{ course: {...} }.id` is undefined.
export function flattenProgressionUnits(
  response: SkoolMemberCoursePermissionsResponse,
): FlatProgressionRow[] {
  const out: FlatProgressionRow[] = [];
  const seen = new Set<string>();

  function emitUnit(unit: SkoolUnit | undefined): void {
    if (!unit?.id || seen.has(unit.id)) return;
    seen.add(unit.id);

    const meta = unit.metadata ?? {};
    const { completed, completionPct } = progressFromMetadata(meta);

    let completedAt: Date | null = null;
    if (completed && unit.updated_at) {
      completedAt = parseActivityDate(unit.updated_at);
    }

    const lastActivityAt = parseActivityDate(unit.updated_at);

    out.push({
      skoolUnitId: unit.id,
      completed,
      completionPct,
      completedAt,
      lastActivityAt,
    });

    const rawChildren = (unit as SkoolUnit & { children?: unknown[] }).children;
    if (!Array.isArray(rawChildren)) return;

    for (const child of rawChildren) {
      if (isCourseTreeNode(child)) {
        emitCourseTree(child);
      } else if (
        typeof child === "object" &&
        child !== null &&
        "id" in child &&
        typeof (child as SkoolUnit).id === "string"
      ) {
        emitUnit(child as SkoolUnit);
      }
    }
  }

  function emitCourseTree(node: SkoolCourseTree): void {
    emitUnit(node.course);
    for (const child of node.children ?? []) {
      emitCourseTree(child);
    }
  }

  for (const entry of response.courses ?? []) {
    if (isCourseTreeNode(entry)) {
      emitCourseTree(entry);
    } else {
      emitUnit(entry as SkoolUnit);
    }
  }

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
