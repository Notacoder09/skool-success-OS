import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { SkoolCourseTree, SkoolUnit } from "@/lib/skool-api";

import { flattenTreeForLessons, normaliseLesson } from "./lessons";

// The DB-touching parts of the orchestrator (lock check, run-row
// updates, upserts) are exercised end-to-end against a real Neon
// instance during development. Here we only unit-test the pure
// functions: tree-walking, lesson normalisation. These are the bits
// most likely to drift if we ever change interpretation.

function unit(opts: {
  id: string;
  parent_id?: string;
  title?: string;
  desc?: string;
  video_link?: string;
  video_thumbnail?: string;
  video_len_ms?: number;
  updated_at?: string;
}): SkoolUnit {
  return {
    id: opts.id,
    name: opts.title ?? opts.id,
    unit_type: "course",
    group_id: "g",
    user_id: "u",
    parent_id: opts.parent_id,
    updated_at: opts.updated_at,
    metadata: {
      title: opts.title,
      desc: opts.desc,
      video_link: opts.video_link,
      video_thumbnail: opts.video_thumbnail,
      video_len_ms: opts.video_len_ms,
    },
  };
}

describe("flattenTreeForLessons", () => {
  it("drops the root and 1-indexes positions for a flat course", () => {
    const tree: SkoolCourseTree = {
      course: unit({ id: "root", title: "meme" }),
      children: [
        { course: unit({ id: "l1", parent_id: "root", title: "Intro" }) },
        { course: unit({ id: "l2", parent_id: "root", title: "trails" }) },
        { course: unit({ id: "l3", parent_id: "root", title: "New page" }) },
        { course: unit({ id: "l4", parent_id: "root", title: "title" }) },
      ],
    };

    const flat = flattenTreeForLessons(tree);
    assert.equal(flat.length, 4);
    assert.deepEqual(
      flat.map((f) => ({ id: f.unit.id, position: f.position })),
      [
        { id: "l1", position: 1 },
        { id: "l2", position: 2 },
        { id: "l3", position: 3 },
        { id: "l4", position: 4 },
      ],
    );
  });

  it("walks nested modules depth-first and continues numbering", () => {
    const tree: SkoolCourseTree = {
      course: unit({ id: "root", title: "Course" }),
      children: [
        {
          course: unit({ id: "m1", parent_id: "root", title: "Module 1" }),
          children: [
            { course: unit({ id: "m1-l1", parent_id: "m1", title: "Lesson 1" }) },
            { course: unit({ id: "m1-l2", parent_id: "m1", title: "Lesson 2" }) },
          ],
        },
        {
          course: unit({ id: "m2", parent_id: "root", title: "Module 2" }),
          children: [
            { course: unit({ id: "m2-l1", parent_id: "m2", title: "Lesson 3" }) },
          ],
        },
      ],
    };

    const flat = flattenTreeForLessons(tree);
    // Module units AND their leaves both get positions because we
    // can't reliably distinguish modules from leaf lessons from the
    // recon shape alone (both unit_type="course"). DFS preserves the
    // creator's intended ordering.
    assert.deepEqual(
      flat.map((f) => f.unit.id),
      ["m1", "m1-l1", "m1-l2", "m2", "m2-l1"],
    );
    assert.deepEqual(
      flat.map((f) => f.position),
      [1, 2, 3, 4, 5],
    );
  });

  it("returns an empty list for a course tree with no children", () => {
    const tree: SkoolCourseTree = {
      course: unit({ id: "root", title: "Empty" }),
    };
    assert.deepEqual(flattenTreeForLessons(tree), []);
  });
});

describe("normaliseLesson", () => {
  it("pulls metadata fields and rounds duration to seconds", () => {
    const norm = normaliseLesson(
      unit({
        id: "l1",
        title: "Intro",
        desc: "Welcome to the course. Three sentences here.",
        video_link: "https://video.skool.com/abc",
        video_thumbnail: "https://thumb.skool.com/abc.jpg",
        video_len_ms: 125_400,
        updated_at: "2026-04-20T10:00:00Z",
      }),
      1,
    );
    assert.equal(norm.skoolLessonId, "l1");
    assert.equal(norm.title, "Intro");
    assert.equal(norm.positionInCourse, 1);
    assert.equal(norm.descriptionWordCount, 7);
    assert.equal(norm.videoUrl, "https://video.skool.com/abc");
    assert.equal(norm.thumbnailUrl, "https://thumb.skool.com/abc.jpg");
    assert.equal(norm.durationSeconds, 125);
    assert.equal(norm.skoolUpdatedAt?.toISOString(), "2026-04-20T10:00:00.000Z");
  });

  it("falls back to unit name when metadata.title is absent", () => {
    const norm = normaliseLesson(unit({ id: "l1" }), 2);
    assert.equal(norm.title, "l1");
  });

  it("returns null word count for empty/whitespace descriptions", () => {
    const norm = normaliseLesson(unit({ id: "l1", desc: "   " }), 1);
    assert.equal(norm.descriptionWordCount, null);
  });

  it("returns null durationSeconds when video_len_ms is missing", () => {
    const norm = normaliseLesson(unit({ id: "l1" }), 1);
    assert.equal(norm.durationSeconds, null);
  });
});
