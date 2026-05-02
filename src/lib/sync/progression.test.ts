import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type {
  SkoolCourseTree,
  SkoolMemberCoursePermissionsResponse,
  SkoolUnit,
} from "@/lib/skool-api";

import { flattenProgressionUnits, progressFromMetadata } from "./progression";

function unit(opts: {
  id: string;
  user_completed?: number;
  completed?: number;
  updated_at?: string;
  progress?: number;
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
      progress: opts.progress,
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
      lastActivityAt: new Date("2026-04-20T10:00:00Z"),
    });
    assert.deepEqual(flat[1], {
      skoolUnitId: "l2",
      completed: false,
      completionPct: null,
      completedAt: null,
      lastActivityAt: null,
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

  it("reads partial completion from metadata.progress (fraction or percent)", () => {
    const resp: SkoolMemberCoursePermissionsResponse = {
      courses: [
        unit({ id: "l1", progress: 0.66, updated_at: "2026-04-21T12:00:00Z" }),
        unit({ id: "l2", progress: 33 }),
      ],
      num_all_courses: 2,
    };
    const flat = flattenProgressionUnits(resp);
    assert.equal(flat[0]?.completionPct, 66);
    assert.equal(flat[0]?.completed, false);
    assert.equal(flat[0]?.completedAt, null);
    assert.deepEqual(flat[0]?.lastActivityAt, new Date("2026-04-21T12:00:00Z"));
    assert.equal(flat[1]?.completionPct, 33);
  });

  it("never invents partial percentages — unknown stays null", () => {
    const resp: SkoolMemberCoursePermissionsResponse = {
      courses: [unit({ id: "l1" })],
      num_all_courses: 1,
    };
    const flat = flattenProgressionUnits(resp);
    assert.equal(flat[0]?.completionPct, null);
    assert.equal(flat[0]?.completedAt, null);
    assert.equal(flat[0]?.lastActivityAt, null);
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
      children: [unit({ id: "c1", user_completed: 1 }), unit({ id: "c2" })],
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

  it("walks SkoolCourseTree-shaped entries (same nesting as GET /courses/{id})", () => {
    const tree: SkoolCourseTree = {
      course: {
        id: "course-root",
        name: "Course",
        unit_type: "course",
        group_id: "g",
        user_id: "u",
        metadata: {},
      },
      children: [
        {
          course: unit({
            id: "lesson-a",
            user_completed: 1,
            updated_at: "2026-05-01T10:00:00Z",
          }),
        },
        { course: unit({ id: "lesson-b", progress: 0.4 }) },
      ],
    };
    const resp: SkoolMemberCoursePermissionsResponse = {
      courses: [tree],
      num_all_courses: 1,
    };
    const flat = flattenProgressionUnits(resp);
    assert.deepEqual(
      flat.map((r) => ({ id: r.skoolUnitId, pct: r.completionPct, done: r.completed })),
      [
        { id: "course-root", pct: null, done: false },
        { id: "lesson-a", pct: 100, done: true },
        { id: "lesson-b", pct: 40, done: false },
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
    assert.equal(flat[0]?.lastActivityAt, null);
  });
});

describe("progressFromMetadata", () => {
  it("treats boolean true as completed", () => {
    const r = progressFromMetadata({ user_completed: true });
    assert.equal(r.completed, true);
    assert.equal(r.completionPct, 100);
  });
});
