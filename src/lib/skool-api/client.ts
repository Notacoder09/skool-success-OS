import type { SkoolCookies } from "../crypto";

import {
  SkoolAuthError,
  SkoolError,
  SkoolNotFoundError,
  SkoolPollTimeoutError,
  SkoolUpstreamError,
} from "./errors";
import type {
  SkoolAdminMetricsResponse,
  SkoolAnalyticsTokenResponse,
  SkoolAnalyticsWaitResponse,
  SkoolCourseTree,
  SkoolGroupCoursesResponse,
  SkoolMemberCoursePermissionsResponse,
} from "./types";

const SKOOL_BASE = "https://api2.skool.com";

// Match the headers Skool's web client sends. Per recon, omitting
// these triggers either 401 or an empty payload depending on the
// endpoint. Keep this stable; we are deliberately presenting as a
// browser session the creator already has.
function defaultHeaders(cookies: SkoolCookies): Record<string, string> {
  return {
    Accept: "*/*",
    "Content-Type": "application/json",
    Cookie: `client_id=${cookies.clientId}; auth_token=${cookies.authToken}`,
    Origin: "https://www.skool.com",
    Referer: "https://www.skool.com/",
    "User-Agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
      "(KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36",
  };
}

export interface SkoolClientOptions {
  cookies: SkoolCookies;
  /** Override the base URL (only useful in tests). */
  baseUrl?: string;
  /** Custom fetch (only useful in tests). */
  fetchImpl?: typeof fetch;
  /** Hard timeout for any single request in ms. */
  timeoutMs?: number;
}

export class SkoolClient {
  private readonly cookies: SkoolCookies;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(opts: SkoolClientOptions) {
    this.cookies = opts.cookies;
    this.baseUrl = opts.baseUrl ?? SKOOL_BASE;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.timeoutMs = opts.timeoutMs ?? 15_000;
  }

  /** Low-level GET. Returns parsed JSON or throws a typed SkoolError. */
  private async get<T>(path: string, init?: RequestInit): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        method: "GET",
        headers: defaultHeaders(this.cookies),
        signal: controller.signal,
        ...init,
      });
    } catch (err) {
      clearTimeout(timer);
      throw new SkoolUpstreamError(`Network error calling Skool: ${path}`, {
        path,
        cause: err,
      });
    }
    clearTimeout(timer);

    if (res.status === 401 || res.status === 403) {
      throw new SkoolAuthError(path, res.status);
    }
    if (res.status === 404) {
      throw new SkoolNotFoundError(path);
    }

    if (!res.ok) {
      const text = await safeText(res);
      throw new SkoolUpstreamError(
        `Skool ${res.status} on ${path}: ${text.slice(0, 200)}`,
        { status: res.status, path },
      );
    }

    try {
      return (await res.json()) as T;
    } catch (err) {
      throw new SkoolUpstreamError(`Failed to parse Skool JSON for ${path}`, {
        path,
        cause: err,
      });
    }
  }

  // --- Documented working endpoints (master plan Part 4) ----------------

  /** GET /courses/{course_id} → full course tree with children. */
  getCourseTree(courseId: string): Promise<SkoolCourseTree> {
    return this.get<SkoolCourseTree>(`/courses/${encodeURIComponent(courseId)}`);
  }

  /** GET /groups/{group_id}/courses → list all courses in group. */
  listGroupCourses(groupId: string): Promise<SkoolGroupCoursesResponse> {
    return this.get<SkoolGroupCoursesResponse>(
      `/groups/${encodeURIComponent(groupId)}/courses`,
    );
  }

  /**
   * GET /groups/{group_id}/member-course-permissions?progression=true&member={id}
   * → per-member course progression.
   */
  getMemberProgression(
    groupId: string,
    memberId: string,
  ): Promise<SkoolMemberCoursePermissionsResponse> {
    const qs = new URLSearchParams({ progression: "true", member: memberId });
    return this.get<SkoolMemberCoursePermissionsResponse>(
      `/groups/${encodeURIComponent(groupId)}/member-course-permissions?${qs.toString()}`,
    );
  }

  /**
   * GET /groups/{group_id}/admin-metrics?range=30d&amt=monthly
   * → time-series of total_members[30], active_members[30], daily_activities.
   */
  getAdminMetrics(
    groupId: string,
    opts: { range?: string; amt?: string } = {},
  ): Promise<SkoolAdminMetricsResponse> {
    const qs = new URLSearchParams({
      range: opts.range ?? "30d",
      amt: opts.amt ?? "monthly",
    });
    return this.get<SkoolAdminMetricsResponse>(
      `/groups/${encodeURIComponent(groupId)}/admin-metrics?${qs.toString()}`,
    );
  }

  /**
   * Async pattern: GET /groups/{id}/analytics-overview-v2 → { token },
   * then poll GET /wait?token={t} until the data is ready.
   */
  async getAnalyticsOverview<T = unknown>(
    groupId: string,
    opts?: { maxWaitMs?: number; intervalMs?: number },
  ): Promise<T> {
    const tokenRes = await this.get<SkoolAnalyticsTokenResponse>(
      `/groups/${encodeURIComponent(groupId)}/analytics-overview-v2`,
    );
    return this.poll<T>(tokenRes.token, opts);
  }

  /** Same async pattern for growth analytics. */
  async getAnalyticsGrowthOverview<T = unknown>(
    groupId: string,
    opts?: { maxWaitMs?: number; intervalMs?: number },
  ): Promise<T> {
    const tokenRes = await this.get<SkoolAnalyticsTokenResponse>(
      `/groups/${encodeURIComponent(groupId)}/analytics-growth-overview-v2`,
    );
    return this.poll<T>(tokenRes.token, opts);
  }

  // --- Helpers ----------------------------------------------------------

  /** Fetch a Skool-hosted asset using the creator's session. */
  async fetchAsset(absoluteUrl: string): Promise<Response> {
    const headers = defaultHeaders(this.cookies);
    // No Accept: */* override on bytes — let the server pick.
    delete (headers as Record<string, string>)["Content-Type"];
    const res = await this.fetchImpl(absoluteUrl, { method: "GET", headers });
    if (res.status === 401 || res.status === 403) {
      throw new SkoolAuthError(absoluteUrl, res.status);
    }
    if (!res.ok) {
      throw new SkoolUpstreamError(`Skool asset ${res.status} on ${absoluteUrl}`, {
        status: res.status,
        path: absoluteUrl,
      });
    }
    return res;
  }

  private async poll<T>(
    token: string,
    opts?: { maxWaitMs?: number; intervalMs?: number },
  ): Promise<T> {
    const deadline = Date.now() + (opts?.maxWaitMs ?? 30_000);
    const interval = opts?.intervalMs ?? 1_000;
    while (Date.now() < deadline) {
      const result = await this.get<SkoolAnalyticsWaitResponse<T>>(
        `/wait?token=${encodeURIComponent(token)}`,
      );
      if (result.status === "ready" && result.data !== undefined) {
        return result.data;
      }
      if (result.status === "error") {
        throw new SkoolUpstreamError(`Skool analytics poll returned error for token`, {
          path: "/wait",
        });
      }
      // Some endpoints return the payload inline once ready (no `status` field).
      if (!result.status && Object.keys(result).length > 0) {
        return result as unknown as T;
      }
      await sleep(interval);
    }
    throw new SkoolPollTimeoutError(token);
  }
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return "";
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export {
  SkoolError,
  SkoolAuthError,
  SkoolNotFoundError,
  SkoolPollTimeoutError,
  SkoolUpstreamError,
};
