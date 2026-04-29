import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { bucketAdminMetricsByDate } from "./metrics-bucket";

describe("bucketAdminMetricsByDate", () => {
  it("returns empty map for all-undefined input", () => {
    const out = bucketAdminMetricsByDate(undefined, undefined, undefined);
    assert.equal(out.size, 0);
  });

  it("buckets the three series onto the same date key", () => {
    const out = bucketAdminMetricsByDate(
      [{ time: "2026-04-26T00:00:00Z", value: 100 }],
      [{ time: "2026-04-26T00:00:00Z", value: 30 }],
      [{ time: "2026-04-26T00:00:00Z", value: 12 }],
    );
    assert.equal(out.size, 1);
    const row = out.get("2026-04-26");
    assert.deepEqual(row, {
      totalMembers: 100,
      activeMembers: 30,
      dailyActivities: 12,
    });
  });

  it("preserves null fields when only some series have a given date", () => {
    const out = bucketAdminMetricsByDate(
      [{ time: "2026-04-26T00:00:00Z", value: 100 }],
      undefined,
      [{ time: "2026-04-26T00:00:00Z", value: 12 }],
    );
    const row = out.get("2026-04-26");
    assert.deepEqual(row, {
      totalMembers: 100,
      activeMembers: null,
      dailyActivities: 12,
    });
  });

  it("ignores points with malformed timestamps", () => {
    const out = bucketAdminMetricsByDate(
      [
        { time: "2026-04-26T00:00:00Z", value: 100 },
        { time: "garbage", value: 999 },
      ],
      undefined,
      undefined,
    );
    assert.equal(out.size, 1);
    assert.ok(out.has("2026-04-26"));
  });

  it("coerces string-shaped numeric values", () => {
    const out = bucketAdminMetricsByDate(
      [{ time: "2026-04-26T00:00:00Z", value: "42" as unknown as number }],
      undefined,
      undefined,
    );
    assert.equal(out.get("2026-04-26")?.totalMembers, 42);
  });

  it("ignores non-numeric values", () => {
    const out = bucketAdminMetricsByDate(
      [{ time: "2026-04-26T00:00:00Z", value: "n/a" as unknown as number }],
      undefined,
      undefined,
    );
    assert.equal(out.get("2026-04-26")?.totalMembers, null);
  });

  it("buckets multiple dates separately", () => {
    const out = bucketAdminMetricsByDate(
      [
        { time: "2026-04-26T00:00:00Z", value: 100 },
        { time: "2026-04-25T12:34:56Z", value: 99 },
      ],
      undefined,
      undefined,
    );
    assert.equal(out.size, 2);
    assert.equal(out.get("2026-04-26")?.totalMembers, 100);
    assert.equal(out.get("2026-04-25")?.totalMembers, 99);
  });
});
