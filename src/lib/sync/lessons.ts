import type { SkoolCourseTree, SkoolUnit } from "@/lib/skool-api";

// Pure helpers used by the sync orchestrator. Kept dependency-free so
// they can be unit-tested without requiring DB env vars or the Next.js
// runtime.

// Walk the course tree depth-first, dropping the root (it represents
// the course itself, not a lesson). Position is 1-indexed across all
// non-root units, which gives us the L1/L2/L3/L4 labels in the V2
// mockup. Nested module structures will all get flattened here; if a
// creator has true nested modules we'll refine in Day 5+ once we see
// real recon data.
export function flattenTreeForLessons(
  tree: SkoolCourseTree,
): Array<{ unit: SkoolUnit; position: number }> {
  const out: Array<{ unit: SkoolUnit; position: number }> = [];
  let position = 0;
  function walk(node: SkoolCourseTree, isRoot: boolean) {
    if (!isRoot) {
      position += 1;
      out.push({ unit: node.course, position });
    }
    for (const child of node.children ?? []) {
      walk(child, false);
    }
  }
  walk(tree, true);
  return out;
}

export interface NormalisedLesson {
  skoolLessonId: string;
  title: string;
  positionInCourse: number;
  description: string | null;
  descriptionWordCount: number | null;
  videoUrl: string | null;
  thumbnailUrl: string | null;
  durationSeconds: number | null;
  skoolUpdatedAt: Date | null;
}

// Pull just the fields we persist from a Skool unit. Pulled out
// of the orchestrator so the mapping is testable without a DB.
export function normaliseLesson(unit: SkoolUnit, position: number): NormalisedLesson {
  const meta = unit.metadata ?? {};
  const title =
    (meta.title as string | undefined) ?? unit.name ?? "Untitled lesson";
  const description = (meta.desc as string | undefined) ?? null;
  const descriptionWordCount =
    description && description.trim().length > 0
      ? description.trim().split(/\s+/).length
      : null;
  const videoUrl = (meta.video_link as string | undefined) ?? null;
  const thumbnailUrl = (meta.video_thumbnail as string | undefined) ?? null;
  const durationMs = (meta.video_len_ms as number | undefined) ?? null;
  return {
    skoolLessonId: unit.id,
    title,
    positionInCourse: position,
    description,
    descriptionWordCount,
    videoUrl,
    thumbnailUrl,
    durationSeconds: durationMs ? Math.round(durationMs / 1000) : null,
    skoolUpdatedAt: unit.updated_at ? new Date(unit.updated_at) : null,
  };
}
