import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  evaluateMondaySchedule,
  REPORT_LOCAL_HOUR,
  weekStartDateForTz,
} from "./schedule";

// All "now" anchors are UTC. We pick concrete instants and assert what
// the scheduler should decide for various creator timezones.

describe("evaluateMondaySchedule", () => {
  it("fires on Monday 7am local for America/New_York (= 11/12 UTC)", () => {
    // 2026-04-27 is a Monday. EDT is UTC-4 in late April.
    const utcNoon = new Date("2026-04-27T11:00:00Z");
    const out = evaluateMondaySchedule(utcNoon, "America/New_York");
    assert.equal(out.shouldFire, true);
    assert.equal(out.localHour, REPORT_LOCAL_HOUR);
    assert.equal(out.localDayOfWeek, 1);
  });

  it("does NOT fire at Monday 8am local for the same creator", () => {
    const utcNoon = new Date("2026-04-27T12:00:00Z");
    const out = evaluateMondaySchedule(utcNoon, "America/New_York");
    assert.equal(out.shouldFire, false);
  });

  it("does NOT fire on Tuesday 7am local", () => {
    const tuesAm = new Date("2026-04-28T11:00:00Z");
    const out = evaluateMondaySchedule(tuesAm, "America/New_York");
    assert.equal(out.shouldFire, false);
  });

  it("fires for UTC creators at 07:00 UTC on Monday", () => {
    const utc = new Date("2026-04-27T07:00:00Z");
    const out = evaluateMondaySchedule(utc, "UTC");
    assert.equal(out.shouldFire, true);
    assert.equal(out.localHour, 7);
  });

  it("fires for Asia/Tokyo creators at the right UTC instant", () => {
    // Tokyo is UTC+9 year-round → Monday 7am Tokyo = Sunday 22:00 UTC.
    const utc = new Date("2026-04-26T22:00:00Z");
    const out = evaluateMondaySchedule(utc, "Asia/Tokyo");
    assert.equal(out.shouldFire, true);
  });

  it("treats invalid timezone strings as UTC instead of throwing", () => {
    const utc = new Date("2026-04-27T07:00:00Z");
    const out = evaluateMondaySchedule(utc, "Not/A_Real_Zone");
    // Falls back to UTC → Monday 7am UTC → should fire.
    assert.equal(out.shouldFire, true);
    // We echo the *requested* tz string in the decision so logs show
    // exactly what was on the creator row, even if we ignored it.
    assert.equal(out.timezone, "Not/A_Real_Zone");
  });
});

describe("weekStartDateForTz", () => {
  it("returns the local Monday's calendar date", () => {
    // Wednesday in NYC.
    const wed = new Date("2026-04-29T15:00:00Z");
    const monday = weekStartDateForTz(wed, "America/New_York");
    assert.equal(monday.toISOString(), "2026-04-27T00:00:00.000Z");
  });

  it("Sunday rolls back to the prior Monday, not forward to next Monday", () => {
    const sun = new Date("2026-04-26T15:00:00Z");
    const monday = weekStartDateForTz(sun, "UTC");
    assert.equal(monday.toISOString(), "2026-04-20T00:00:00.000Z");
  });

  it("a Monday returns itself", () => {
    const mon = new Date("2026-04-27T08:00:00Z");
    const monday = weekStartDateForTz(mon, "UTC");
    assert.equal(monday.toISOString(), "2026-04-27T00:00:00.000Z");
  });
});
