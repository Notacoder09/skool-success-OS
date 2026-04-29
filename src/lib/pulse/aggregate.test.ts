import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  activityByDayOfWeek,
  latestValue,
  trendOverWindow,
  type DailyPoint,
} from "./aggregate";

const day = (iso: string): Date => new Date(`${iso}T00:00:00Z`);

const point = (
  iso: string,
  overrides: Partial<DailyPoint> = {},
): DailyPoint => ({
  date: day(iso),
  totalMembers: null,
  activeMembers: null,
  dailyActivities: null,
  ...overrides,
});

describe("trendOverWindow", () => {
  it("returns null for empty input", () => {
    assert.equal(trendOverWindow([], "totalMembers", 7), null);
  });

  it("classifies up when latest is >5% above prior", () => {
    const points: DailyPoint[] = [
      point("2026-04-19", { activeMembers: 100 }),
      point("2026-04-26", { activeMembers: 110 }),
    ];
    const t = trendOverWindow(points, "activeMembers", 7);
    assert.ok(t);
    assert.equal(t.trend, "up");
    assert.equal(Math.round(t.pctDelta!), 10);
    assert.equal(t.delta, 10);
  });

  it("classifies down when latest is >5% below prior", () => {
    const points: DailyPoint[] = [
      point("2026-04-19", { activeMembers: 100 }),
      point("2026-04-26", { activeMembers: 80 }),
    ];
    const t = trendOverWindow(points, "activeMembers", 7);
    assert.ok(t);
    assert.equal(t.trend, "down");
  });

  it("classifies flat for tiny wiggles (within ±5%)", () => {
    const points: DailyPoint[] = [
      point("2026-04-19", { activeMembers: 100 }),
      point("2026-04-26", { activeMembers: 102 }),
    ];
    const t = trendOverWindow(points, "activeMembers", 7);
    assert.ok(t);
    assert.equal(t.trend, "flat");
  });

  it("returns null when prior point is missing for the field", () => {
    const points: DailyPoint[] = [
      point("2026-04-19", { totalMembers: 100 }), // missing activeMembers
      point("2026-04-26", { activeMembers: 80 }),
    ];
    assert.equal(trendOverWindow(points, "activeMembers", 7), null);
  });

  it("returns null when prior is 0 (avoid divide-by-zero) only if delta is 0; otherwise classifies by sign", () => {
    const points: DailyPoint[] = [
      point("2026-04-19", { activeMembers: 0 }),
      point("2026-04-26", { activeMembers: 5 }),
    ];
    const t = trendOverWindow(points, "activeMembers", 7);
    assert.ok(t);
    // pctDelta is null because prior was zero, but trend should
    // still classify by absolute delta sign.
    assert.equal(t.pctDelta, null);
    assert.equal(t.trend, "up");
  });

  it("falls back to nearest earlier point when exact day-7 is missing", () => {
    const points: DailyPoint[] = [
      point("2026-04-17", { activeMembers: 100 }), // 9d ago, closest earlier
      point("2026-04-21", { activeMembers: 110 }), // 5d ago, too recent
      point("2026-04-26", { activeMembers: 130 }),
    ];
    const t = trendOverWindow(points, "activeMembers", 7);
    assert.ok(t);
    assert.equal(t.prior, 100);
    assert.equal(t.latest, 130);
  });
});

describe("activityByDayOfWeek", () => {
  it("returns 7 zeros for empty input", () => {
    assert.deepEqual(activityByDayOfWeek([]), [0, 0, 0, 0, 0, 0, 0]);
  });

  it("sums activities into the right day-of-week bucket", () => {
    // 2026-04-26 is a Sunday (UTC). Verify by JS:
    assert.equal(day("2026-04-26").getUTCDay(), 0);
    const points: DailyPoint[] = [
      point("2026-04-26", { dailyActivities: 5 }), // Sun
      point("2026-04-27", { dailyActivities: 3 }), // Mon
      point("2026-04-19", { dailyActivities: 4 }), // Sun (prev week)
    ];
    const out = activityByDayOfWeek(points);
    assert.equal(out[0], 9); // Sunday: 5+4
    assert.equal(out[1], 3); // Monday
  });

  it("ignores null daily-activity points", () => {
    const points: DailyPoint[] = [
      point("2026-04-26", { dailyActivities: null }),
      point("2026-04-26", { dailyActivities: 7 }),
    ];
    const out = activityByDayOfWeek(points);
    assert.equal(out[0], 7);
  });
});

describe("latestValue", () => {
  it("returns the latest non-null reading", () => {
    const points: DailyPoint[] = [
      point("2026-04-20", { activeMembers: 100 }),
      point("2026-04-26", { activeMembers: 120 }),
    ];
    assert.equal(latestValue(points, "activeMembers"), 120);
  });

  it("skips null readings", () => {
    const points: DailyPoint[] = [
      point("2026-04-20", { activeMembers: 100 }),
      point("2026-04-26", { activeMembers: null }),
    ];
    assert.equal(latestValue(points, "activeMembers"), 100);
  });

  it("returns null for empty input", () => {
    assert.equal(latestValue([], "activeMembers"), null);
  });
});
