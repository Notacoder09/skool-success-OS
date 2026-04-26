import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type {
  SkoolMemberCoursePermissionsResponse,
  SkoolUnit,
} from "@/lib/skool-api";

import { flattenProgressionUnits } from "./progression";

function unit(opts: {
  id: string;
  user_completed?: number;
  completed?: number;
  updated_at?: string;
}): SkoolUnit {
  return {
    id: opts.id,
    name: opts.id,
    unit_type: "course",
    group_id: "g",
    user_id: "u",
    updated_at: opts.updated_at,
    metadata: {
      user_completed: opts.user_completed,
      completed: opts.completed,
    },
  };
}

describe("flattenProgressionUnits", () => {
  it("marks units with user_completed=1 as completed at 100%", () => {
    const resp: SkoolMemberCoursePermissionsResponse = {
      courses: [
        unit({ id: "l1", user_completed: 1, updated_at: "2026-04-20T10:00:00Z" }),
        unit({ id: "l2", user_completed: 0 }),
      ],
      num_all_courses: 2,
    };
    const flat = flattenProgressionUnits(resp);
    assert.equal(flat.length, 2);
    assert.deepEqual(flat[0], {
      skoolUnitId: "l1",
      completed: true,
      completionPct: 100,
      completedAt: new Date("2026-04-20T10:00:00Z"),
    });
    assert.deepEqual(flat[1], {
      skoolUnitId: "l2",
      completed: false,
      completionPct: null,
      completedAt: null,
    });
  });

  it("treats the legacy `completed` field equivalently to user_completed", () => {
    const resp: SkoolMemberCoursePermissionsResponse = {
      courses: [unit({ id: "l1", completed: 1 })],
      num_all_courses: 1,
    };
    const flat = flattenProgressionUnits(resp);
    assert.equal(flat[0]?.completed, true);
    assert.equal(flat[0]?.completionPct, 100);
  });

  it("never invents partial percentages — unknown stays null", () => {
    const resp: SkoolMemberCoursePermissionsResponse = {
      courses: [unit({ id: "l1" })],
      num_all_courses: 1,
    };
    const flat = flattenProgressionUnits(resp);
    assert.equal(flat[0]?.completionPct, null);
    assert.equal(flat[0]?.completedAt, null);
  });

  it("dedupes units that appear twice (some Skool responses repeat root)", () => {
    const dup = unit({ id: "l1", user_completed: 1 });
    const resp: SkoolMemberCoursePermissionsResponse = {
      courses: [dup, dup],
      num_all_courses: 1,
    };
    const flat = flattenProgressionUnits(resp);
    assert.equal(flat.length, 1);
  });

  it("walks nested children if Skool ever returns them", () => {
    const nested = {
      id: "root",
      name: "root",
      unit_type: "course",
      group_id: "g",
      user_id: "u",
      metadata: {},
      // Defensive: shape not in current types, included on purpose.
      children: [
        unit({ id: "c1", user_completed: 1 }),
        unit({ id: "c2" }),
      ],
    } as unknown as SkoolUnit;
    const resp: SkoolMemberCoursePermissionsResponse = {
      courses: [nested],
      num_all_courses: 1,
    };
    const flat = flattenProgressionUnits(resp);
    assert.deepEqual(
      flat.map((r) => ({ id: r.skoolUnitId, done: r.completed })),
      [
        { id: "root", done: false },
        { id: "c1", done: true },
        { id: "c2", done: false },
      ],
    );
  });

  it("is a no-op for an empty response", () => {
    assert.deepEqual(
      flattenProgressionUnits({ courses: [], num_all_courses: 0 }),
      [],
    );
  });

  it("ignores invalid updated_at strings without throwing", () => {
    const resp: SkoolMemberCoursePermissionsResponse = {
      courses: [unit({ id: "l1", user_completed: 1, updated_at: "not-a-date" })],
      num_all_courses: 1,
    };
    const flat = flattenProgressionUnits(resp);
    assert.equal(flat[0]?.completed, true);
    assert.equal(flat[0]?.completedAt, null);
  });
});
