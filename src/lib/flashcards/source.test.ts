import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  describeSource,
  MIN_DESCRIPTION_WORDS,
  resolveFlashcardSource,
  type SourceCreatorInput,
  type SourceInput,
  type SourceLessonInput,
} from "./source";

const baseLesson: SourceLessonInput = {
  id: "lesson-1",
  title: "Intro to Funnels",
  description: null,
  descriptionWordCount: null,
  attachedDocUrl: null,
  videoUrl: null,
  durationSeconds: null,
};

const offCreator: SourceCreatorInput = {
  transcriptionEnabled: false,
  transcriptionMinutesQuota: 250,
  minutesUsedThisMonth: 0,
};

const onCreator: SourceCreatorInput = {
  transcriptionEnabled: true,
  transcriptionMinutesQuota: 250,
  minutesUsedThisMonth: 0,
};

function input(over: Partial<SourceInput> = {}): SourceInput {
  return {
    lesson: { ...baseLesson, ...over.lesson },
    cachedTranscript: over.cachedTranscript ?? null,
    creator: over.creator ?? offCreator,
    pdfText: over.pdfText ?? null,
  };
}

const longDescription = Array.from({ length: 120 }, (_, i) => `word${i}`).join(" ");

describe("resolveFlashcardSource — decision tree priority", () => {
  it("step 1 wins: description ≥ 100 words even when a cached transcript exists", () => {
    const result = resolveFlashcardSource(
      input({
        lesson: {
          ...baseLesson,
          description: longDescription,
          descriptionWordCount: 120,
        },
        cachedTranscript: { id: "x", text: "stale", source: "whisper" },
      }),
    );
    assert.equal(result.kind, "use");
    if (result.kind === "use") {
      assert.equal(result.source, "description");
    }
  });

  it("step 2 wins when description is short but cache is present", () => {
    const result = resolveFlashcardSource(
      input({
        lesson: {
          ...baseLesson,
          description: "two words",
          descriptionWordCount: 2,
        },
        cachedTranscript: {
          id: "content-77",
          text: "the cached transcript text",
          source: "whisper",
        },
      }),
    );
    assert.equal(result.kind, "use");
    if (result.kind === "use") {
      assert.equal(result.source, "whisper");
      assert.equal(result.sourceContentId, "content-77");
    }
  });

  it("step 3 PDF text wins when description is thin and no cache", () => {
    const result = resolveFlashcardSource(
      input({
        lesson: { ...baseLesson, description: "tiny" },
        pdfText: longDescription,
      }),
    );
    assert.equal(result.kind, "use");
    if (result.kind === "use") {
      assert.equal(result.source, "pdf");
    }
  });

  it("derives word count when descriptionWordCount is null", () => {
    const result = resolveFlashcardSource(
      input({
        lesson: {
          ...baseLesson,
          description: longDescription,
          descriptionWordCount: null,
        },
      }),
    );
    assert.equal(result.kind, "use");
  });

  it("MIN_DESCRIPTION_WORDS boundary: 99 words → not enough, 100 → enough", () => {
    const ninety9 = Array.from({ length: 99 }, () => "word").join(" ");
    const oneHundred = Array.from({ length: 100 }, () => "word").join(" ");
    const a = resolveFlashcardSource(
      input({
        lesson: {
          ...baseLesson,
          description: ninety9,
          descriptionWordCount: 99,
        },
      }),
    );
    assert.equal(a.kind, "skip");

    const b = resolveFlashcardSource(
      input({
        lesson: {
          ...baseLesson,
          description: oneHundred,
          descriptionWordCount: 100,
        },
      }),
    );
    assert.equal(b.kind, "use");
    assert.equal(MIN_DESCRIPTION_WORDS, 100);
  });
});

describe("resolveFlashcardSource — gate ordering (steps 4-7)", () => {
  it("step 4: transcription disabled skips with the right reason", () => {
    const result = resolveFlashcardSource(
      input({
        lesson: { ...baseLesson, videoUrl: "https://video" },
        creator: offCreator,
      }),
    );
    assert.deepEqual(result, { kind: "skip", reason: "transcription_disabled" });
  });

  it("step 5: quota reached overrides Whisper", () => {
    const result = resolveFlashcardSource(
      input({
        lesson: { ...baseLesson, videoUrl: "https://video", durationSeconds: 600 },
        creator: { ...onCreator, minutesUsedThisMonth: 250 },
      }),
    );
    assert.deepEqual(result, { kind: "skip", reason: "quota_reached" });
  });

  it("step 5: 0 quota means UNLIMITED, not blocked", () => {
    const result = resolveFlashcardSource(
      input({
        lesson: { ...baseLesson, videoUrl: "https://video", durationSeconds: 600 },
        creator: { ...onCreator, transcriptionMinutesQuota: 0, minutesUsedThisMonth: 9999 },
      }),
    );
    assert.equal(result.kind, "transcribe");
  });

  it("step 6: opted-in + quota left + has video → transcribe", () => {
    const result = resolveFlashcardSource(
      input({
        lesson: {
          ...baseLesson,
          videoUrl: "https://video",
          durationSeconds: 320,
        },
        creator: { ...onCreator, minutesUsedThisMonth: 0 },
      }),
    );
    assert.equal(result.kind, "transcribe");
    if (result.kind === "transcribe") {
      assert.equal(result.estimatedMinutes, 6);
      assert.equal(result.videoUrl, "https://video");
    }
  });

  it("step 7: nothing usable, no video → thin_signal", () => {
    const result = resolveFlashcardSource(input({ creator: onCreator }));
    assert.deepEqual(result, { kind: "skip", reason: "thin_signal" });
  });
});

describe("describeSource", () => {
  it("renders human labels for each successful source", () => {
    assert.equal(describeSource("description", null).label, "From description");
    assert.equal(describeSource("pdf", null).label, "From PDF");
    assert.equal(describeSource("cached", null).label, "Cached");
    assert.equal(describeSource("whisper", null).label, "Whisper transcript");
  });

  it("renders skip reasons distinctly", () => {
    assert.match(
      describeSource("skipped", "transcription_disabled").label,
      /transcription off/i,
    );
    assert.match(
      describeSource("skipped", "quota_reached").label,
      /quota/i,
    );
    assert.match(
      describeSource("skipped", "thin_signal").label,
      /too little content/i,
    );
  });
});
