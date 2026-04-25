export { SkoolClient } from "./client";
export type { SkoolClientOptions } from "./client";
export {
  SkoolAuthError,
  SkoolError,
  SkoolNotFoundError,
  SkoolPollTimeoutError,
  SkoolUpstreamError,
} from "./errors";
export type {
  SkoolAdminMetricsResponse,
  SkoolAnalyticsTokenResponse,
  SkoolAnalyticsWaitResponse,
  SkoolCourseTree,
  SkoolGroupCoursesResponse,
  SkoolMemberCoursePermissionsResponse,
  SkoolTimePoint,
  SkoolUnit,
  SkoolUnitMetadata,
  SkoolUnitType,
} from "./types";

// Re-export the SkoolCookies payload type from the crypto module so
// callers don't have to reach across module boundaries to construct
// a client.
export type { SkoolCookies } from "../crypto";
