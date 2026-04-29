// Day 7 — "Suggested next actions" for the lesson zoom page.
//
// The Day 6 AI banner gives the creator narrative ("when members stop
// here, they usually don't come back…"). Narrative is necessary but
// not sufficient — creators reading this on a Tuesday morning want a
// short list of things to *try this week*. That's what this module
// produces.
//
// Why deterministic (no Anthropic call) for now?
//   - The set of recommended actions is small and finite — they all
//     trace back to a handful of rules in the wisdom doc. Generating
//     them with LLMs would invent more variation than is honest.
//   - We always want the same advice for the same data. A creator
//     who refreshes shouldn't see "rewatch retention" one minute and
//     "split the lesson" the next, because the underlying signal
//     hasn't changed.
//   - Cheap. The AI prose covers the warmth/voice, the structured
//     list covers the spine.
//
// Wisdom-doc rules encoded here (docs/creator-wisdom-and-product-decisions.md):
//   - >40% drop-off on a lesson = "high attention" — needs intervention
//   - Module 1–2 drops are weighted heavier ("early drop = will never
//     come back")
//   - Cliff drops point at the *transition* — the previous lesson is
//     usually where the fix lives, not the destination
//   - "Less is more" — recommend subtracting before adding
//   - No more than 3 actions ever (the "overwhelm rule")

export interface SuggestionInput {
  /** Position of the lesson in question (1-indexed). */
  lessonPosition: number;
  /** Total lessons in the course. Used to detect "early in course". */
  courseLessonCount: number;
  /** This lesson's completion %. Null if no data. */
  lessonCompletionPct: number | null;
  /** Previous lesson's completion %, if any. */
  previousCompletionPct: number | null;
  /** Number of members enrolled / on the course. Used to gauge signal strength. */
  memberCount: number;
}

export interface SuggestedAction {
  id:
    | "split-or-trim"
    | "rewatch-previous"
    | "post-quick-win"
    | "shorten-early-curriculum"
    | "ask-stuck-members"
    | "hold-the-data";
  /** ≤ 6 word headline (mockup-style). */
  title: string;
  /** 1–2 sentence explanation. Plain text, no markdown. */
  body: string;
  /** Why this action came up — names the rule from the wisdom doc. */
  reason: string;
}

const ALL_RULES: Array<{
  id: SuggestedAction["id"];
  applies: (i: SuggestionInput) => boolean;
  build: (i: SuggestionInput) => SuggestedAction;
  /** Higher = ranks earlier when multiple rules fire. */
  weight: (i: SuggestionInput) => number;
}> = [
  {
    // Cliff drop: the previous lesson is where the fix lives.
    id: "rewatch-previous",
    applies: (i) =>
      i.lessonCompletionPct !== null &&
      i.previousCompletionPct !== null &&
      i.previousCompletionPct - i.lessonCompletionPct >= 25,
    build: (i) => ({
      id: "rewatch-previous",
      title: "Rewatch the lesson before this",
      body:
        `The drop happens between L${i.lessonPosition - 1} and L${i.lessonPosition}, ` +
        "which usually means L" +
        (i.lessonPosition - 1) +
        " is where the bottleneck is — too long, too dense, or assumes too much. " +
        "Watch it back and ask: would deleting half of this get more people through?",
      reason: "Wisdom doc: cliff drops point at the previous lesson, not the destination.",
    }),
    // Cliff drops are the most actionable signal we have.
    weight: (i) =>
      100 +
      Math.max(
        0,
        (i.previousCompletionPct ?? 0) - (i.lessonCompletionPct ?? 0),
      ),
  },
  {
    // High-drop-off lesson with no previous reference (lesson 1, or
    // previous lesson has no data).
    id: "split-or-trim",
    applies: (i) =>
      i.lessonCompletionPct !== null && i.lessonCompletionPct < 60,
    build: (i) => ({
      id: "split-or-trim",
      title: "Split or trim this lesson",
      body:
        `Only ${Math.round(i.lessonCompletionPct ?? 0)}% of enrolled members finish L${i.lessonPosition}. ` +
        "Before you add more content, try the opposite: cut the lesson in half, " +
        "or break it into two shorter lessons with a quick win at the end of each.",
      reason: "Wisdom doc: > 40% drop-off = high attention; less is more.",
    }),
    // Lower base weight so cliff fires first when both apply.
    weight: (i) => 60 + (60 - (i.lessonCompletionPct ?? 60)),
  },
  {
    // Early-course lesson with any drop-off — wisdom doc says these
    // matter more than later-course drops.
    id: "shorten-early-curriculum",
    applies: (i) =>
      i.lessonCompletionPct !== null &&
      i.lessonCompletionPct < 75 &&
      i.lessonPosition <= 2 &&
      i.courseLessonCount >= 3,
    build: (i) => ({
      id: "shorten-early-curriculum",
      title: "Tighten the first two lessons",
      body:
        "Members who stall in module 1–2 rarely come back. Aim for a quick win " +
        "by lesson 2 — something they can show off, post about, or tell a friend. " +
        "If your current L1 and L2 don't get them there, this is the highest-leverage place to edit.",
      reason: "Wisdom doc: early-course drop-off = 90-day churn signal.",
    }),
    weight: () => 40,
  },
  {
    // Healthy lesson but a leak still — recommend a community quick win.
    id: "post-quick-win",
    applies: (i) =>
      i.lessonCompletionPct !== null && i.lessonCompletionPct >= 60,
    build: () => ({
      id: "post-quick-win",
      title: "Post a quick-win prompt",
      body:
        "This lesson isn't broken, but a few people are stuck mid-way. Post a short " +
        "challenge tied to it (\"share one thing you applied this week\"). " +
        "Engagement at this point usually pulls slow finishers across the line.",
      reason: "Wisdom doc: belonging = ability to keep up; quick wins early = retention.",
    }),
    weight: () => 20,
  },
  {
    // Always-available qualitative move: ask the people who actually stopped.
    id: "ask-stuck-members",
    applies: (i) => i.lessonCompletionPct !== null && i.memberCount >= 3,
    build: (i) => ({
      id: "ask-stuck-members",
      title: "Ask 2–3 stuck members why",
      body:
        "Find members who started L" +
        i.lessonPosition +
        " but didn't finish, and DM them: \"hey, what got in the way?\". " +
        "You'll get more signal from 3 conversations than from any dashboard.",
      reason: "Wisdom doc: relationship moves over surveillance metrics.",
    }),
    weight: () => 15,
  },
  {
    // Tiny-sample escape hatch.
    id: "hold-the-data",
    applies: (i) => i.memberCount < 5,
    build: (i) => ({
      id: "hold-the-data",
      title: "Hold off on big edits",
      body:
        `With ${i.memberCount} ${i.memberCount === 1 ? "member" : "members"} on this course, ` +
        "the percentages swing wildly when one person finishes a lesson. Wait until you " +
        "have 5+ enrolled before you redesign — until then, focus on getting more people in.",
      reason: "Wisdom doc: tiny samples mislead; relationship matters more than dashboards.",
    }),
    // Highest weight when it applies — it's an honesty move, not a fix.
    weight: () => 200,
  },
];

const MAX_ACTIONS = 3;

// Returns up to 3 ranked, deduplicated actions for the given lesson.
// Empty list when there's no data (caller should render "Not enough
// data yet" copy in that case).
export function buildSuggestedActions(
  input: SuggestionInput,
): SuggestedAction[] {
  if (input.lessonCompletionPct === null) return [];

  const fired = ALL_RULES
    .filter((rule) => rule.applies(input))
    .sort((a, b) => b.weight(input) - a.weight(input));

  const actions: SuggestedAction[] = [];
  const seen = new Set<SuggestedAction["id"]>();

  for (const rule of fired) {
    if (seen.has(rule.id)) continue;
    actions.push(rule.build(input));
    seen.add(rule.id);
    if (actions.length >= MAX_ACTIONS) break;
  }

  return actions;
}
