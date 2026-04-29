import Anthropic from "@anthropic-ai/sdk";

import { buildPromptHeader, type SourceLessonInput } from "./source";

// Days 11-13 — flashcard generation for Feature 2.
//
// Voice locked by docs/creator-wisdom-and-product-decisions.md
// "Member email tone" + master plan §"Tone for member-facing emails":
// neutral teacher voice, member-side audience (not the creator),
// short, no metrics, no upsell.
//
// Two modes mirror the Day 6 insight pipeline:
//   - Anthropic (when ANTHROPIC_API_KEY is set): Claude Sonnet 4.5
//   - Fallback (no key, or call fails): deterministic heuristic that
//     produces 3 reasonable cards from the lesson title + first ~600
//     chars of source text. The fallback is intentionally simple —
//     beta creators see plausible cards without a paid key wired up.
//
// Hard cap: 3-5 cards per lesson (wisdom doc, "overwhelm rule").

const ANTHROPIC_MODEL = "claude-sonnet-4-5-20250929";
const FALLBACK_MODEL_NAME = "fallback-flashcards-v1";

export const FLASHCARD_MIN = 3;
export const FLASHCARD_MAX = 5;

const SYSTEM_PROMPT = `You write flashcards for paying members of an online community. The reader is the student, not the community owner. They have 30 minutes a week to spend on this material. You are not a marketer; you are a thoughtful teacher who is helping them remember the lesson they just finished.

Voice rules (non-negotiable):
- Address the student directly ("you"), never the creator.
- Write the way a teacher would say it out loud — short, plain, kind.
- Each question should test recall of an idea the lesson actually taught, not test reading comprehension of the description.
- Each answer is one to three sentences, plain prose. No emojis. No markdown. No exclamation points.
- Do NOT reference the creator by name. Do NOT plug the community. Do NOT mention churn, retention, or the product.
- Output 3 to 5 cards, never fewer than 3 and never more than 5.

Output format (strict): a JSON object with one key, "cards", whose value is an array of objects, each with exactly two keys: "question" (string) and "answer" (string). Output ONLY the JSON, no preamble, no trailing prose.`;

export interface FlashcardCard {
  question: string;
  answer: string;
}

export interface FlashcardGenInput {
  lesson: SourceLessonInput;
  /** Already-resolved source text (description, pdf, or transcript). */
  sourceText: string;
}

export interface FlashcardGenResult {
  cards: FlashcardCard[];
  model: string;
}

export interface FlashcardGenConfig {
  apiKey?: string | null;
  model?: string;
}

/**
 * Public entrypoint. Always returns a usable, non-empty card array.
 * If the LLM is unavailable or returns garbage we fall back to a
 * deterministic generator so creators in beta see something sensible.
 */
export async function generateFlashcards(
  input: FlashcardGenInput,
  config: FlashcardGenConfig = {},
): Promise<FlashcardGenResult> {
  const apiKey = config.apiKey ?? process.env.ANTHROPIC_API_KEY ?? null;
  if (!apiKey) {
    return {
      cards: buildFallbackCards(input),
      model: FALLBACK_MODEL_NAME,
    };
  }

  try {
    const client = new Anthropic({ apiKey });
    const userPrompt = buildUserPrompt(input);
    const model = config.model ?? ANTHROPIC_MODEL;
    const response = await client.messages.create({
      model,
      max_tokens: 1200,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userPrompt }],
    });

    const raw = extractText(response);
    const parsed = parseCards(raw);
    if (!parsed) {
      // eslint-disable-next-line no-console
      console.warn(
        "[flashcards/generate] anthropic returned unparseable JSON, using fallback",
      );
      return { cards: buildFallbackCards(input), model: FALLBACK_MODEL_NAME };
    }

    const capped = capCards(parsed);
    if (capped.length < FLASHCARD_MIN) {
      // Model gave us too few; pad from the fallback rather than ship
      // 1 card. Keeps the spec floor honest.
      const filler = buildFallbackCards(input);
      const padded = capCards([...capped, ...filler]);
      return { cards: padded, model };
    }
    return { cards: capped, model };
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[flashcards/generate] anthropic call failed, fallback", err);
    return { cards: buildFallbackCards(input), model: FALLBACK_MODEL_NAME };
  }
}

/**
 * Enforces the 3-5 card cap from the wisdom doc. Trims to FLASHCARD_MAX,
 * and de-dupes by question text (case-insensitive whitespace-collapsed).
 * Pure — exposed for testing the boundary directly.
 */
export function capCards(cards: FlashcardCard[]): FlashcardCard[] {
  const seen = new Set<string>();
  const out: FlashcardCard[] = [];
  for (const card of cards) {
    if (out.length >= FLASHCARD_MAX) break;
    const question = (card.question ?? "").trim();
    const answer = (card.answer ?? "").trim();
    if (!question || !answer) continue;
    const key = question.toLowerCase().replace(/\s+/g, " ");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ question, answer });
  }
  return out;
}

/**
 * Deterministic fallback. Produces three short cards anchored on:
 *   1. What this lesson is about (title + first ~120 chars of source)
 *   2. The single most useful sentence we can extract from the source
 *   3. A reflective prompt that doesn't depend on extraction quality
 *
 * Exported for tests; the orchestrator and the LLM path also call it.
 */
export function buildFallbackCards(input: FlashcardGenInput): FlashcardCard[] {
  const title = input.lesson.title.trim();
  const cleaned = input.sourceText.replace(/\s+/g, " ").trim();
  const sentences = splitSentences(cleaned).slice(0, 8);
  const firstIdea = sentences[0] ?? cleaned.slice(0, 200);
  const secondIdea =
    sentences.find((s, i) => i > 0 && s.length > 40 && s.length < 240) ??
    sentences[1] ??
    null;

  const cards: FlashcardCard[] = [
    {
      question: `What is "${title}" about, in one sentence?`,
      answer:
        firstIdea.length > 0
          ? truncate(firstIdea, 240)
          : `"${title}" was the lesson you just finished. Try summarising it in your own words before reading on.`,
    },
  ];

  if (secondIdea) {
    cards.push({
      question: `What is the main point you want to remember from "${title}"?`,
      answer: truncate(secondIdea, 240),
    });
  } else {
    cards.push({
      question: `Which idea from "${title}" felt most useful to you?`,
      answer:
        "Pick one specific phrase or moment from the lesson and write it down somewhere you'll see it this week. Recall is stronger when you give yourself a place to find it.",
    });
  }

  cards.push({
    question: `If you had to apply "${title}" to your week, what would you change first?`,
    answer:
      "One concrete change beats five abstract ones. Pick the smallest version of the lesson you can act on before our next email arrives.",
  });

  return cards;
}

function buildUserPrompt(input: FlashcardGenInput): string {
  const header = buildPromptHeader(input.lesson);
  const trimmed = input.sourceText.length > 8000
    ? input.sourceText.slice(0, 8000) + "\n[truncated for length]"
    : input.sourceText;
  return [
    header,
    "",
    "Lesson source content (use this as the primary substrate; do not invent facts that aren't here):",
    trimmed,
    "",
    `Write ${FLASHCARD_MIN}-${FLASHCARD_MAX} flashcards for the student who just completed this lesson. Output JSON only, in the format described in the system prompt.`,
  ].join("\n");
}

function extractText(response: Anthropic.Message): string {
  const parts: string[] = [];
  for (const block of response.content) {
    if (block.type === "text") parts.push(block.text);
  }
  return parts.join("").trim();
}

/**
 * Parse a JSON-shaped LLM response into FlashcardCard[]. Tolerates
 * stray prose around the JSON block (Claude sometimes wraps in
 * markdown fences); returns null if no usable JSON found.
 * Exported for tests.
 */
export function parseCards(raw: string): FlashcardCard[] | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  const candidates: string[] = [];
  candidates.push(trimmed);
  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenceMatch?.[1]) candidates.push(fenceMatch[1]);
  const objectMatch = trimmed.match(/\{[\s\S]*\}/);
  if (objectMatch?.[0]) candidates.push(objectMatch[0]);

  for (const c of candidates) {
    try {
      const value: unknown = JSON.parse(c);
      const cards = coerceCards(value);
      if (cards) return cards;
    } catch {
      // try the next candidate
    }
  }
  return null;
}

function coerceCards(value: unknown): FlashcardCard[] | null {
  let arr: unknown = null;
  if (Array.isArray(value)) arr = value;
  else if (
    value &&
    typeof value === "object" &&
    "cards" in value &&
    Array.isArray((value as { cards: unknown }).cards)
  ) {
    arr = (value as { cards: unknown[] }).cards;
  }
  if (!Array.isArray(arr)) return null;

  const out: FlashcardCard[] = [];
  for (const item of arr) {
    if (!item || typeof item !== "object") continue;
    const obj = item as Record<string, unknown>;
    const q = obj.question ?? obj.q ?? obj.prompt;
    const a = obj.answer ?? obj.a ?? obj.response;
    if (typeof q !== "string" || typeof a !== "string") continue;
    out.push({ question: q, answer: a });
  }
  return out.length > 0 ? out : null;
}

function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"'(])/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  const slice = text.slice(0, max - 1);
  const lastSpace = slice.lastIndexOf(" ");
  return (lastSpace > max * 0.7 ? slice.slice(0, lastSpace) : slice) + "…";
}

export const FLASHCARD_FALLBACK_MODEL = FALLBACK_MODEL_NAME;
export const FLASHCARD_ANTHROPIC_MODEL = ANTHROPIC_MODEL;
