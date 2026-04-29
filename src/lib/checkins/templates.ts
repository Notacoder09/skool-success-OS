import type { MemberRiskFlag, RiskReasonKind } from "./at-risk";

// DM tone templates from `creator-wisdom-and-product-decisions.md`,
// Feature 4. Three styles, creator picks. Pure substitution.
//
// Voice rules from master plan Part 6:
//   - Cite specific names, never "Member #4729"
//   - Honest about uncertainty ("noticed you've been quiet" — not
//     "data shows engagement decline")
//   - Never panicked or growth-marketing language
//
// We intentionally keep the templates short. Anything longer than 2
// lines reads as "automated" — Sam's "sup" is the gold standard.

export type DraftTone = "sam" | "hamza" | "professional";

export const TONES: DraftTone[] = ["sam", "hamza", "professional"];

export const TONE_LABELS: Record<DraftTone, string> = {
  sam: "Sam style",
  hamza: "Hamza style",
  professional: "Professional",
};

export const TONE_DESCRIPTIONS: Record<DraftTone, string> = {
  sam: 'Short. "sup, how\'s it going?"',
  hamza: 'Warm. "saw you haven\'t been around — anything you need?"',
  professional: 'Polished. "noticed you\'ve been quiet, everything good?"',
};

export interface DraftMessageInput {
  tone: DraftTone;
  firstName: string | null;
  reasonKind: RiskReasonKind;
}

/**
 * Returns the drafted DM body. Caller copies this to clipboard.
 * Never includes "AI generated" framing — the creator owns the words.
 */
export function draftMessage(input: DraftMessageInput): string {
  const name = (input.firstName?.trim() || "").trim();
  const greeting = name ? `Hey ${name}` : "Hey";
  switch (input.tone) {
    case "sam": {
      // Sam Ovens "sup" check-in. Deliberately tiny.
      return name
        ? `${name}, sup — how's everything going?`
        : `sup — how's everything going?`;
    }
    case "hamza": {
      // Hamza style: warmer, opens the door wide.
      return name
        ? `Yo ${name}, saw you haven't been around — what's up bro, anything you need?`
        : `Saw you haven't been around — what's up, anything you need?`;
    }
    case "professional": {
      // Professional: still human, tied to the specific reason so it
      // doesn't read as a mass-DM.
      const tail = professionalTail(input.reasonKind);
      return `${greeting}, noticed you've been quiet this week. ${tail} Let me know if there's anything I can help with.`;
    }
  }
}

function professionalTail(reason: RiskReasonKind): string {
  switch (reason) {
    case "stalled_mid_course":
      return "If you got stuck on a lesson, no worries — happens to most folks.";
    case "tenure_dropoff":
      return "Just wanted to check in.";
    case "brand_new_ghost":
      return "If the start felt overwhelming, that's pretty normal.";
  }
}

/**
 * Builds all three drafts at once — used by /check-ins to populate
 * the buttons without burning render time computing them lazily.
 */
export function draftAllTones(args: {
  firstName: string | null;
  flag: MemberRiskFlag;
}): Record<DraftTone, string> {
  return {
    sam: draftMessage({
      tone: "sam",
      firstName: args.firstName,
      reasonKind: args.flag.reasonKind,
    }),
    hamza: draftMessage({
      tone: "hamza",
      firstName: args.firstName,
      reasonKind: args.flag.reasonKind,
    }),
    professional: draftMessage({
      tone: "professional",
      firstName: args.firstName,
      reasonKind: args.flag.reasonKind,
    }),
  };
}

/**
 * Pull the first name from a "First Last" display name. Returns null
 * when the input is empty/whitespace.
 */
export function firstNameFrom(name: string | null): string | null {
  if (!name) return null;
  const trimmed = name.trim();
  if (!trimmed) return null;
  return trimmed.split(/\s+/)[0] ?? null;
}
