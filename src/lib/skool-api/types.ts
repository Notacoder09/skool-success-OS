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
  user_completed?: number;
  user_has_access?: number;
  has_access?: number;
  completed?: number;
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

export interface SkoolMemberCoursePermissionsResponse {
  courses: SkoolUnit[];
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
