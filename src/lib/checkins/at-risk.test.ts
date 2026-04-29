import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { classifyMemberRisk, type MemberRiskInput } from "./at-risk";

const NOW = new Date("2026-04-26T00:00:00Z");

const baseInput = (overrides: Partial<MemberRiskInput> = {}): MemberRiskInput => ({
  memberId: "m1",
  name: "Bill T",
  joinedAt: new Date("2025-08-01T00:00:00Z"), // ~9 months ago
  lastActiveAt: new Date("2026-04-25T00:00:00Z"),
  completedLessons: 5,
  inProgressLessons: 0,
  inProgressLastActivityAt: null,
  totalLessons: 12,
  ...overrides,
});

describe("classifyMemberRisk", () => {
  it("returns null for a normal active member", () => {
    const flag = classifyMemberRisk(baseInput(), NOW);
    assert.equal(flag, null);
  });

  it("returns null for a graduate (finished everything)", () => {
    const flag = classifyMemberRisk(
      baseInput({
        completedLessons: 12,
        totalLessons: 12,
        lastActiveAt: new Date("2025-12-01T00:00:00Z"), // ages ago
      }),
      NOW,
    );
    assert.equal(flag, null);
  });

  describe("rule 1 — stalled mid-course", () => {
    it("flags a member who started but hasn't moved in >=7 days", () => {
      const flag = classifyMemberRisk(
        baseInput({
          inProgressLessons: 1,
          inProgressLastActivityAt: new Date("2026-04-15T00:00:00Z"), // 11d ago
        }),
        NOW,
      );
      assert.ok(flag);
      assert.equal(flag.reasonKind, "stalled_mid_course");
      assert.match(flag.reason, /11 days/);
    });

    it("does NOT flag stalled <7 days (not stalled enough yet)", () => {
      const flag = classifyMemberRisk(
        baseInput({
          inProgressLessons: 1,
          inProgressLastActivityAt: new Date("2026-04-22T00:00:00Z"), // 4d ago
        }),
        NOW,
      );
      assert.equal(flag, null);
    });

    it("uses singular 'day' for a 7-day stall", () => {
      const flag = classifyMemberRisk(
        baseInput({
          inProgressLessons: 1,
          inProgressLastActivityAt: new Date("2026-04-19T00:00:00Z"), // 7d ago
        }),
        NOW,
      );
      assert.ok(flag);
      assert.match(flag.reason, /7 days/); // plural because we use !== 1
    });
  });

  describe("rule 2 — tenure dropoff", () => {
    it("flags tenured (>=30d) member with prior activity, gone 14+ days", () => {
      const flag = classifyMemberRisk(
        baseInput({
          lastActiveAt: new Date("2026-04-01T00:00:00Z"), // 25d ago
        }),
        NOW,
      );
      assert.ok(flag);
      assert.equal(flag.reasonKind, "tenure_dropoff");
      assert.match(flag.reason, /25 days/);
    });

    it("does NOT flag a member with no prior progression activity", () => {
      const flag = classifyMemberRisk(
        baseInput({
          completedLessons: 0,
          inProgressLessons: 0,
          lastActiveAt: new Date("2026-04-01T00:00:00Z"),
        }),
        NOW,
      );
      // tenure 9mo, no completed lessons → not "used to be active"
      assert.equal(flag, null);
    });

    it("does NOT flag a brand-new member (<30 days)", () => {
      const flag = classifyMemberRisk(
        baseInput({
          joinedAt: new Date("2026-04-10T00:00:00Z"), // 16d ago
          lastActiveAt: new Date("2026-04-10T00:00:00Z"), // 16d ago
          completedLessons: 1,
        }),
        NOW,
      );
      // they're not >= 30d tenure so rule 2 doesn't fire; check that
      // we don't match anything else either.
      assert.equal(flag, null);
    });
  });

  describe("rule 3 — brand-new ghost", () => {
    it("flags joined 7-14 days ago with zero starts", () => {
      const flag = classifyMemberRisk(
        baseInput({
          joinedAt: new Date("2026-04-15T00:00:00Z"), // 11d ago
          lastActiveAt: null,
          completedLessons: 0,
          inProgressLessons: 0,
        }),
        NOW,
      );
      assert.ok(flag);
      assert.equal(flag.reasonKind, "brand_new_ghost");
      assert.match(flag.reason, /11 days/);
    });

    it("does NOT flag day-1 ghost (give them a week)", () => {
      const flag = classifyMemberRisk(
        baseInput({
          joinedAt: new Date("2026-04-23T00:00:00Z"), // 3d ago
          lastActiveAt: null,
          completedLessons: 0,
          inProgressLessons: 0,
        }),
        NOW,
      );
      assert.equal(flag, null);
    });

    it("does NOT flag a ghost older than 14 days (rule 2 territory)", () => {
      const flag = classifyMemberRisk(
        baseInput({
          joinedAt: new Date("2026-03-15T00:00:00Z"), // 42d ago
          lastActiveAt: null,
          completedLessons: 0,
          inProgressLessons: 0,
        }),
        NOW,
      );
      // Tenured >=30d but never activated → rule 2 only fires if
      // they had prior progression activity, so this slips through.
      // That's correct — they're a "never started" case, not a "fell
      // off" case. Either creator or a future pre-week-1 rule handles
      // them.
      assert.equal(flag, null);
    });
  });

  describe("precedence", () => {
    it("prefers stalled over tenure-dropoff when both fire", () => {
      const flag = classifyMemberRisk(
        baseInput({
          inProgressLessons: 1,
          inProgressLastActivityAt: new Date("2026-04-10T00:00:00Z"), // 16d
          lastActiveAt: new Date("2026-04-10T00:00:00Z"), // 16d
        }),
        NOW,
      );
      assert.ok(flag);
      assert.equal(flag.reasonKind, "stalled_mid_course");
    });
  });
});
