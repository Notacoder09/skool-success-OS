// Types modelled from the recon results in
// ~/Desktop/skool-recon/recon-results.json (master plan Part 4).
// Keep these conservative: every field optional unless we've seen
// it consistently across multiple recon runs.

export type SkoolUnitType = "course" | "module" | string;

export interface SkoolUnit {
  id: string;
  name: string;
  unit_type: SkoolUnitType;
  group_id: string;
  user_id: string;
  parent_id?: string;
  root_id?: string;
  state?: number;
  public?: boolean;
  created_at?: string;
  updated_at?: string;
  metadata?: SkoolUnitMetadata;
}

export interface SkoolUnitMetadata {
  title?: string;
  desc?: string;
  cover_image?: string;
  video_link?: string;
  video_id?: string;
  video_thumbnail?: string;
  video_len_ms?: number;
  num_modules?: number;
  user_completed?: number | boolean | string;
  user_has_access?: number;
  has_access?: number;
  completed?: number | boolean | string;
  /** Fraction 0–1 or percent 0–100 — seen on progression payloads */
  progress?: number;
  watch_progress?: number;
  completion_progress?: number;
  percent_complete?: number;
  video_progress?: number;
  privacy?: number;
  resources?: string;
  [k: string]: unknown;
}

export interface SkoolCourseTree {
  course: SkoolUnit;
  children?: SkoolCourseTree[];
}

export interface SkoolGroupCoursesResponse {
  courses: SkoolUnit[];
  num_all_courses: number;
}

export interface SkoolGroupResponse {
  id?: string;
  name?: string;
  title?: string;
  group_name?: string;
  display_name?: string;
  slug?: string;
  [k: string]: unknown;
}

export interface SkoolMemberCoursePermissionsResponse {
  /**
   * Often mirrors `GET /courses/{id}` — each entry may be a full
   * {@link SkoolCourseTree} (`{ course, children }`) even when typed
   * loosely as {@link SkoolUnit} in older recon.
   */
  courses: Array<SkoolUnit | SkoolCourseTree>;
  num_all_courses: number;
}

export interface SkoolAnalyticsTokenResponse {
  token: string;
}

export interface SkoolAnalyticsWaitResponse<T = unknown> {
  status?: "pending" | "ready" | "error";
  data?: T;
  // Some Skool poll responses just return the data inline once ready.
  // Keep this loose; callers narrow with `unwrapAnalytics()`.
  [k: string]: unknown;
}

export interface SkoolTimePoint {
  time: string; // ISO datetime
  value: number;
}

export interface SkoolAdminMetricsResponse {
  total_members?: SkoolTimePoint[];
  active_members?: SkoolTimePoint[];
  daily_activities?: SkoolTimePoint[];
  [k: string]: unknown;
}
