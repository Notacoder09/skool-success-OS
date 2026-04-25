import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  SkoolAuthError,
  SkoolClient,
  SkoolNotFoundError,
  SkoolPollTimeoutError,
  SkoolUpstreamError,
} from "./index";

const COOKIES = { authToken: "jwt.test", clientId: "client-test" };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function textResponse(body: string, status = 200): Response {
  return new Response(body, { status });
}

function makeFetch(routes: Record<string, () => Response | Promise<Response>>): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    const path = new URL(url).pathname + new URL(url).search;
    const handler =
      routes[path] ?? routes[new URL(url).pathname] ?? routes["*"];
    if (!handler) throw new Error(`Unmocked path: ${path}`);
    return handler();
  }) as typeof fetch;
}

describe("SkoolClient.getCourseTree", () => {
  it("parses the documented course-tree shape", async () => {
    const client = new SkoolClient({
      cookies: COOKIES,
      fetchImpl: makeFetch({
        "/courses/abc": () =>
          jsonResponse({
            course: {
              id: "abc",
              name: "root",
              unit_type: "course",
              group_id: "g",
              user_id: "u",
              metadata: { title: "Root" },
            },
            children: [
              {
                course: {
                  id: "child-1",
                  name: "child-1",
                  unit_type: "module",
                  group_id: "g",
                  user_id: "u",
                  parent_id: "abc",
                  metadata: { title: "Lesson 1" },
                },
              },
            ],
          }),
      }),
    });

    const tree = await client.getCourseTree("abc");
    assert.equal(tree.course.id, "abc");
    assert.equal(tree.children?.length, 1);
    assert.equal(tree.children?.[0]?.course.metadata?.title, "Lesson 1");
  });

  it("throws SkoolAuthError on 401", async () => {
    const client = new SkoolClient({
      cookies: COOKIES,
      fetchImpl: makeFetch({ "/courses/abc": () => textResponse("nope", 401) }),
    });
    await assert.rejects(client.getCourseTree("abc"), SkoolAuthError);
  });

  it("throws SkoolNotFoundError on 404", async () => {
    const client = new SkoolClient({
      cookies: COOKIES,
      fetchImpl: makeFetch({ "/courses/abc": () => textResponse("404", 404) }),
    });
    await assert.rejects(client.getCourseTree("abc"), SkoolNotFoundError);
  });

  it("throws SkoolUpstreamError on bad JSON", async () => {
    const client = new SkoolClient({
      cookies: COOKIES,
      fetchImpl: makeFetch({ "/courses/abc": () => textResponse("not json", 200) }),
    });
    await assert.rejects(client.getCourseTree("abc"), SkoolUpstreamError);
  });
});

describe("SkoolClient.getAnalyticsOverview (async poll pattern)", () => {
  it("polls until status=ready and returns the data payload", async () => {
    let calls = 0;
    const client = new SkoolClient({
      cookies: COOKIES,
      fetchImpl: makeFetch({
        "/groups/g/analytics-overview-v2": () => jsonResponse({ token: "tok-1" }),
        "/wait": () => {
          calls += 1;
          if (calls < 3) return jsonResponse({ status: "pending" });
          return jsonResponse({ status: "ready", data: { metric: 42 } });
        },
      }),
    });

    const result = await client.getAnalyticsOverview<{ metric: number }>("g", {
      intervalMs: 1,
      maxWaitMs: 1_000,
    });
    assert.deepEqual(result, { metric: 42 });
    assert.equal(calls, 3);
  });

  it("throws SkoolPollTimeoutError when poll never resolves", async () => {
    const client = new SkoolClient({
      cookies: COOKIES,
      fetchImpl: makeFetch({
        "/groups/g/analytics-overview-v2": () => jsonResponse({ token: "tok-1" }),
        "/wait": () => jsonResponse({ status: "pending" }),
      }),
    });
    await assert.rejects(
      client.getAnalyticsOverview("g", { intervalMs: 5, maxWaitMs: 25 }),
      SkoolPollTimeoutError,
    );
  });
});

describe("SkoolClient.getAdminMetrics", () => {
  it("returns the time-series payload", async () => {
    const client = new SkoolClient({
      cookies: COOKIES,
      fetchImpl: makeFetch({
        "/groups/g/admin-metrics?range=30d&amt=monthly": () =>
          jsonResponse({
            total_members: [{ time: "2026-04-22T00:00:00Z", value: 3 }],
            active_members: [{ time: "2026-04-22T00:00:00Z", value: 2 }],
          }),
      }),
    });

    const metrics = await client.getAdminMetrics("g");
    assert.equal(metrics.total_members?.length, 1);
    assert.equal(metrics.total_members?.[0]?.value, 3);
  });
});
