import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { MemberRiskFlag } from "./at-risk";
import { rankCheckIns, rankScore, type RankableInput } from "./rank";

const flag = (id: string, tenureDays: number): MemberRiskFlag => ({
  memberId: id,
  reasonKind: "tenure_dropoff",
  reason: "test",
  daysSinceActive: 14,
  tenureDays,
});

describe("rankScore", () => {
  it("rewards longer tenure", () => {
    const newish: RankableInput = { flag: flag("a", 30), completedLessons: 0 };
    const tenured: RankableInput = { flag: flag("b", 200), completedLessons: 0 };
    assert.ok(rankScore(tenured) > rankScore(newish));
  });

  it("rewards prior progress (winnability)", () => {
    const noProgress: RankableInput = { flag: flag("a", 90), completedLessons: 0 };
    const progressed: RankableInput = { flag: flag("a", 90), completedLessons: 8 };
    assert.ok(rankScore(progressed) > rankScore(noProgress));
  });

  it("uses LTV as a tie-breaker only", () => {
    const lowLtv: RankableInput = {
      flag: flag("a", 90),
      completedLessons: 5,
      ltv: 0,
    };
    const highLtv: RankableInput = {
      flag: flag("b", 90),
      completedLessons: 5,
      ltv: 1000,
    };
    assert.ok(rankScore(highLtv) > rankScore(lowLtv));
    // But tenure beats LTV — a tenured-no-LTV beats new-paying:
    const tenuredNoLtv: RankableInput = {
      flag: flag("c", 365),
      completedLessons: 5,
    };
    assert.ok(rankScore(tenuredNoLtv) > rankScore(highLtv));
  });

  it("caps tenure signal at 365 (avoid one whale dominating)", () => {
    const oneYear: RankableInput = { flag: flag("a", 365), completedLessons: 5 };
    const fiveYear: RankableInput = { flag: flag("b", 365 * 5), completedLessons: 5 };
    assert.equal(rankScore(oneYear), rankScore(fiveYear));
  });
});

describe("rankCheckIns", () => {
  const inputs: RankableInput[] = [
    { flag: flag("new", 14), completedLessons: 0 },
    { flag: flag("tenured", 200), completedLessons: 5 },
    { flag: flag("graduate", 365), completedLessons: 10 },
    { flag: flag("midway", 60), completedLessons: 3 },
  ];

  it("returns inputs ranked by score, descending", () => {
    const out = rankCheckIns(inputs);
    assert.deepEqual(
      out.map((x) => x.flag.memberId),
      ["graduate", "tenured", "midway", "new"],
    );
  });

  it("respects the cap", () => {
    const out = rankCheckIns(inputs, 2);
    assert.equal(out.length, 2);
    assert.deepEqual(
      out.map((x) => x.flag.memberId),
      ["graduate", "tenured"],
    );
  });

  it("is stable on tie scores", () => {
    const ties: RankableInput[] = [
      { flag: flag("first", 90), completedLessons: 5 },
      { flag: flag("second", 90), completedLessons: 5 },
      { flag: flag("third", 90), completedLessons: 5 },
    ];
    const out = rankCheckIns(ties);
    assert.deepEqual(
      out.map((x) => x.flag.memberId),
      ["first", "second", "third"],
    );
  });
});
