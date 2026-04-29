import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildFallbackCards,
  capCards,
  FLASHCARD_FALLBACK_MODEL,
  FLASHCARD_MAX,
  FLASHCARD_MIN,
  generateFlashcards,
  parseCards,
} from "./generate";

const lesson = {
  id: "l-1",
  title: "Building Your First Funnel",
  description: null,
  descriptionWordCount: null,
  attachedDocUrl: null,
  videoUrl: null,
  durationSeconds: null,
};

describe("capCards", () => {
  it("trims to FLASHCARD_MAX (5)", () => {
    const many = Array.from({ length: 9 }, (_, i) => ({
      question: `Q${i}`,
      answer: `A${i}`,
    }));
    assert.equal(capCards(many).length, FLASHCARD_MAX);
  });

  it("dedupes by case- and whitespace-insensitive question text", () => {
    const dupes = [
      { question: "What  is X?", answer: "A1" },
      { question: "what is x?", answer: "A2" },
      { question: "What is Y?", answer: "A3" },
    ];
    const out = capCards(dupes);
    assert.equal(out.length, 2);
    assert.equal(out[0]?.question, "What  is X?");
    assert.equal(out[1]?.question, "What is Y?");
  });

  it("drops cards with empty question or answer", () => {
    const cards = [
      { question: "", answer: "A" },
      { question: "Q", answer: "" },
      { question: "Q2", answer: "A2" },
    ];
    const out = capCards(cards);
    assert.equal(out.length, 1);
    assert.equal(out[0]?.question, "Q2");
  });
});

describe("parseCards", () => {
  it("parses raw JSON object with cards key", () => {
    const raw = JSON.stringify({
      cards: [
        { question: "Q1", answer: "A1" },
        { question: "Q2", answer: "A2" },
      ],
    });
    const out = parseCards(raw);
    assert.deepEqual(out, [
      { question: "Q1", answer: "A1" },
      { question: "Q2", answer: "A2" },
    ]);
  });

  it("parses raw JSON array", () => {
    const raw = JSON.stringify([{ question: "Q", answer: "A" }]);
    const out = parseCards(raw);
    assert.deepEqual(out, [{ question: "Q", answer: "A" }]);
  });

  it("tolerates markdown fences", () => {
    const raw = '```json\n{"cards":[{"question":"Q","answer":"A"}]}\n```';
    const out = parseCards(raw);
    assert.equal(out?.length, 1);
  });

  it("tolerates a JSON object embedded in prose", () => {
    const raw = 'Here you go:\n{"cards":[{"question":"Q","answer":"A"}]}\nDone.';
    const out = parseCards(raw);
    assert.equal(out?.length, 1);
  });

  it("returns null on garbage", () => {
    assert.equal(parseCards(""), null);
    assert.equal(parseCards("not even close"), null);
  });

  it("rejects items missing question or answer", () => {
    const raw = JSON.stringify({
      cards: [
        { question: "Q1" },
        { answer: "A2" },
        { question: "Q3", answer: "A3" },
      ],
    });
    const out = parseCards(raw);
    assert.equal(out?.length, 1);
    assert.equal(out?.[0]?.question, "Q3");
  });

  it("accepts q/a or prompt/response aliases", () => {
    const raw = JSON.stringify({
      cards: [
        { q: "Q1", a: "A1" },
        { prompt: "Q2", response: "A2" },
      ],
    });
    const out = parseCards(raw);
    assert.equal(out?.length, 2);
  });
});

describe("buildFallbackCards", () => {
  it("always returns >= FLASHCARD_MIN cards", () => {
    const cards = buildFallbackCards({
      lesson,
      sourceText: "",
    });
    assert.ok(cards.length >= FLASHCARD_MIN);
    assert.ok(cards.length <= FLASHCARD_MAX);
  });

  it("uses extracted sentences from source text when available", () => {
    const sourceText =
      "A funnel is a sequence that turns strangers into buyers. The narrowest part is the offer page. Always test one variable at a time.";
    const cards = buildFallbackCards({ lesson, sourceText });
    assert.ok(cards.length >= FLASHCARD_MIN);
    assert.ok(
      cards.some((c) =>
        c.answer.toLowerCase().includes("funnel") ||
        c.answer.toLowerCase().includes("sequence"),
      ),
    );
  });

  it("references the lesson title in at least one question", () => {
    const cards = buildFallbackCards({
      lesson,
      sourceText: "Some content.",
    });
    assert.ok(
      cards.some((c) => c.question.includes("Building Your First Funnel")),
    );
  });
});

describe("generateFlashcards (no API key path)", () => {
  it("returns the fallback model name when ANTHROPIC_API_KEY is missing", async () => {
    const result = await generateFlashcards(
      { lesson, sourceText: "Some lesson source." },
      { apiKey: null },
    );
    assert.equal(result.model, FLASHCARD_FALLBACK_MODEL);
    assert.ok(result.cards.length >= FLASHCARD_MIN);
    assert.ok(result.cards.length <= FLASHCARD_MAX);
  });
});
