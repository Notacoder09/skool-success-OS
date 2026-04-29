export {
  syncCommunity,
  upsertCourse,
  upsertLessonsFromTree,
  SyncAlreadyRunningError,
  STALE_RUNNING_WINDOW_MS,
} from "./orchestrator";
export type {
  SyncOptions,
  SyncRunSummary,
  SyncStatus,
  SyncTrigger,
  SyncWarning,
} from "./orchestrator";
export { flattenTreeForLessons, normaliseLesson } from "./lessons";
export type { NormalisedLesson } from "./lessons";
export { flattenProgressionUnits } from "./progression";
export type {
  FlatProgressionRow,
  ProgressionSyncResult,
  ProgressionWarning,
} from "./progression";
export { harvestSkoolUuids, isSkoolUuid } from "./harvest";
export {
  computeLessonCompletionPct,
  toneForCompletion,
} from "./aggregation";
export type {
  CompletionCounts,
  CompletionTone,
} from "./aggregation";
export { findLargestCliff, formatCliff } from "./cliffs";
export type { Cliff, CliffLesson } from "./cliffs";
export {
  discoverMembersFromAnalytics,
  recomputeLessonCompletion,
  syncProgressionForKnownMembers,
} from "./members";
export type {
  AggregationResult,
  DiscoveryResult,
  DiscoveryWarning,
} from "./members";
