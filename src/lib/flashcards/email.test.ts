import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildFlashcardEmail } from "./email";

const cards = [
  {
    question: "What is the narrow part of a funnel?",
    answer: "The offer page — where the visitor decides yes or no.",
  },
  {
    question: "How do you test funnel improvements?",
    answer: "Change one variable at a time so you can read the result.",
  },
  {
    question: "Why focus on a sequence?",
    answer: "It moves strangers to buyers in clear, recoverable steps.",
  },
];

describe("buildFlashcardEmail", () => {
  it("personalises the subject with first name and lesson label", () => {
    const out = buildFlashcardEmail({
      firstName: "Sarah",
      lessonTitle: "Building Your First Funnel",
      cards,
      lessonLabel: "Lesson 3",
    });
    assert.match(out.subject, /^Sarah — notes for Lesson 3/);
    assert.match(out.subject, /60-second review/);
  });

  it("HTML body contains the lesson title and every card", () => {
    const out = buildFlashcardEmail({
      firstName: "Sarah",
      lessonTitle: "Building Your First Funnel",
      cards,
      lessonLabel: "Lesson 3",
    });
    assert.match(out.html, /Building Your First Funnel/);
    for (const card of cards) {
      assert.ok(out.html.includes(card.question));
      assert.ok(out.html.includes(card.answer));
    }
  });

  it("text body contains every card and a Card N label", () => {
    const out = buildFlashcardEmail({
      firstName: "Sarah",
      lessonTitle: "Building Your First Funnel",
      cards,
      lessonLabel: "Lesson 3",
    });
    assert.match(out.text, /Card 1/);
    assert.match(out.text, /Card 2/);
    assert.match(out.text, /Card 3/);
    for (const card of cards) {
      assert.ok(out.text.includes(card.question));
      assert.ok(out.text.includes(card.answer));
    }
  });

  it("escapes HTML-significant characters in user-provided fields", () => {
    const out = buildFlashcardEmail({
      firstName: "<Sarah>",
      lessonTitle: 'Funnel "101" & beyond',
      cards: [{ question: "Q<>", answer: 'A "test"' }],
      lessonLabel: "Lesson 3",
    });
    assert.ok(out.html.includes("&lt;Sarah&gt;"));
    assert.ok(out.html.includes("Funnel &quot;101&quot; &amp; beyond"));
    assert.ok(out.html.includes("Q&lt;&gt;"));
    assert.ok(out.html.includes("A &quot;test&quot;"));
  });

  it("does not include forbidden creator-side phrases", () => {
    const out = buildFlashcardEmail({
      firstName: "Sarah",
      lessonTitle: "Building Your First Funnel",
      cards,
      lessonLabel: "Lesson 3",
    });
    // Voice rules: no progress %, no churn/retention talk, no exclamation points.
    assert.doesNotMatch(out.text, /churn/i);
    assert.doesNotMatch(out.text, /retention/i);
    assert.doesNotMatch(out.text, /\d+%/);
    assert.doesNotMatch(out.text, /!/);
  });
});
