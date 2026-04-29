import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { canonicaliseHeader, parseLtv, parseMembersCsv } from "./members";

describe("canonicaliseHeader", () => {
  it("maps common email aliases", () => {
    assert.equal(canonicaliseHeader("Email"), "email");
    assert.equal(canonicaliseHeader("E-Mail"), "email");
    assert.equal(canonicaliseHeader(" email_address "), "email");
  });

  it("maps name aliases", () => {
    assert.equal(canonicaliseHeader("Full Name"), "name");
    assert.equal(canonicaliseHeader("Display Name"), "name");
  });

  it("maps Skool ID aliases", () => {
    assert.equal(canonicaliseHeader("Member ID"), "skoolMemberId");
    assert.equal(canonicaliseHeader("user_id"), "skoolMemberId");
  });

  it("maps the new Skool export shape (FirstName, LastName, Tier, LTV)", () => {
    assert.equal(canonicaliseHeader("FirstName"), "firstName");
    assert.equal(canonicaliseHeader("First Name"), "firstName");
    assert.equal(canonicaliseHeader("LastName"), "lastName");
    assert.equal(canonicaliseHeader("Last Name"), "lastName");
    assert.equal(canonicaliseHeader("JoinedDate"), "joinedAt");
    assert.equal(canonicaliseHeader("Tier"), "tier");
    assert.equal(canonicaliseHeader("LTV"), "ltv");
  });

  it("returns null for unknown headers", () => {
    // Question1, Answer1, Invited By, Price, Recurring Interval are
    // all expected to be ignored when we see them in the Skool export.
    assert.equal(canonicaliseHeader("Question1"), null);
    assert.equal(canonicaliseHeader("Answer3"), null);
    assert.equal(canonicaliseHeader("Invited By"), null);
    assert.equal(canonicaliseHeader("Price"), null);
    assert.equal(canonicaliseHeader("Recurring Interval"), null);
    assert.equal(canonicaliseHeader(""), null);
  });
});

describe("parseLtv", () => {
  it("strips dollar signs", () => {
    assert.equal(parseLtv("$0"), 0);
    assert.equal(parseLtv("$49.00"), 49);
    assert.equal(parseLtv("$1,234.56"), 1234.56);
  });

  it("returns null for empty/non-numeric input", () => {
    assert.equal(parseLtv(""), null);
    assert.equal(parseLtv("   "), null);
    assert.equal(parseLtv(undefined), null);
    assert.equal(parseLtv("not a number"), null);
  });

  it("rounds to two decimals to match the DB precision", () => {
    assert.equal(parseLtv("$10.999"), 11);
    assert.equal(parseLtv("$10.001"), 10);
  });
});

describe("parseMembersCsv — legacy shape (Email + Name + optional Member ID)", () => {
  it("parses a basic Email+Name+Joined CSV", () => {
    const csv = [
      "Name,Email,Joined",
      "Bill T,bill@example.com,2026-01-01",
      "Yuy Yuy,yuy@example.com,2026-02-01",
    ].join("\n");
    const result = parseMembersCsv(csv);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.totalRows, 2);
    assert.equal(result.rows.length, 2);
    assert.equal(result.rows[0]?.email, "bill@example.com");
    assert.equal(result.rows[0]?.name, "Bill T");
    assert.equal(
      result.rows[0]?.joinedAt?.toISOString(),
      "2026-01-01T00:00:00.000Z",
    );
  });

  it("captures Skool member ID when present and UUID-shaped", () => {
    const csv = [
      "Name,Email,Member ID",
      "Bill T,bill@example.com,a7c8f33668dc4bd49d4306c5c1ac3f12",
      "Yuy,yuy@example.com,90d98eb5a4774afbbde9559d4c7a0291",
    ].join("\n");
    const result = parseMembersCsv(csv);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(
      result.rows[0]?.skoolMemberId,
      "a7c8f33668dc4bd49d4306c5c1ac3f12",
    );
    assert.equal(
      result.rows[1]?.skoolMemberId,
      "90d98eb5a4774afbbde9559d4c7a0291",
    );
  });

  it("drops non-UUID 'IDs' silently (Skool sometimes exports row indexes)", () => {
    const csv = "Email,Member ID\nx@y.com,42";
    const result = parseMembersCsv(csv);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.rows[0]?.skoolMemberId, null);
  });

  it("rejects rows with malformed (non-empty) emails but accepts empty ones", () => {
    const csv = [
      "Name,Email",
      "OK,ok@example.com",
      "Bad,not-an-email",
      "Empty,",
    ].join("\n");
    const result = parseMembersCsv(csv);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    // OK + Empty (now allowed because it has a name) make it through.
    assert.equal(result.rows.length, 2);
    assert.equal(result.rows[0]?.email, "ok@example.com");
    assert.equal(result.rows[1]?.email, null);
    assert.equal(result.rows[1]?.name, "Empty");
    // Only the malformed one is rejected.
    assert.equal(result.rejectedRows.length, 1);
    assert.equal(result.rejectedRows[0]?.reason, "invalid email");
  });

  it("dedupes by email within the CSV, case-insensitively", () => {
    const csv = ["Name,Email", "A,x@y.com", "B,X@Y.com"].join("\n");
    const result = parseMembersCsv(csv);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.rows.length, 1);
    assert.equal(result.rejectedRows[0]?.reason, "duplicate email in CSV");
  });
});

describe("parseMembersCsv — Skool admin export shape", () => {
  // Headers and example row from the live export the creator confirmed
  // on 2026-04-27. Empty fields stay literally empty.
  const FULL_HEADER =
    "FirstName,LastName,Email,Invited By,JoinedDate,Question1,Answer1,Question2,Answer2,Question3,Answer3,Price,Recurring Interval,Tier,LTV";

  it("parses a Skool export row with empty email/questions/price", () => {
    const csv = [
      FULL_HEADER,
      "Bill,T,,,2026-04-23 06:30:35,,,,,,,,,standard,$0",
    ].join("\n");
    const result = parseMembersCsv(csv);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.totalRows, 1);
    assert.equal(result.rows.length, 1);
    const row = result.rows[0]!;
    assert.equal(row.firstName, "Bill");
    assert.equal(row.lastName, "T");
    assert.equal(row.name, "Bill T");
    assert.equal(row.email, null);
    assert.equal(row.tier, "standard");
    assert.equal(row.ltv, 0);
    assert.equal(row.joinedAt?.toISOString(), "2026-04-23T06:30:35.000Z");
  });

  it("strips the $ from LTV and parses numeric values", () => {
    const csv = [
      FULL_HEADER,
      "Pro,User,pro@example.com,,2026-04-23 06:30:35,,,,,,,,,Pro,$49.00",
      "Free,User,free@example.com,,2026-04-23 06:30:35,,,,,,,,,standard,$0",
    ].join("\n");
    const result = parseMembersCsv(csv);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.rows[0]?.ltv, 49);
    assert.equal(result.rows[0]?.tier, "Pro");
    assert.equal(result.rows[1]?.ltv, 0);
    assert.equal(result.rows[1]?.tier, "standard");
  });

  it("imports rows that have no email at all (most Skool free members)", () => {
    const csv = [
      FULL_HEADER,
      "Bill,T,,,2026-04-23 06:30:35,,,,,,,,,standard,$0",
      "Sue,W,,,2026-04-24 11:00:00,,,,,,,,,standard,$0",
    ].join("\n");
    const result = parseMembersCsv(csv);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.rows.length, 2);
    assert.equal(result.rows[0]?.email, null);
    assert.equal(result.rows[1]?.email, null);
    assert.equal(result.rejectedRows.length, 0);
  });

  it("dedupes emailless rows by name + joined date", () => {
    const csv = [
      FULL_HEADER,
      "Bill,T,,,2026-04-23 06:30:35,,,,,,,,,standard,$0",
      "Bill,T,,,2026-04-23 06:30:35,,,,,,,,,standard,$0",
    ].join("\n");
    const result = parseMembersCsv(csv);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.rows.length, 1);
    assert.equal(result.rejectedRows.length, 1);
    assert.match(result.rejectedRows[0]!.reason, /duplicate name/);
  });

  it("treats two emailless people with different join times as distinct", () => {
    // Two Bills who happen to share a name. Different joined timestamps
    // ⇒ different members.
    const csv = [
      FULL_HEADER,
      "Bill,T,,,2026-04-23 06:30:35,,,,,,,,,standard,$0",
      "Bill,T,,,2026-04-23 06:30:36,,,,,,,,,standard,$0",
    ].join("\n");
    const result = parseMembersCsv(csv);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.rows.length, 2);
  });

  it("rejects rows with no name and no email and no Skool ID", () => {
    // Mix one good row in so the parser doesn't bail early with
    // "every row was rejected".
    const csv = [
      FULL_HEADER,
      "Bill,T,,,2026-04-23 06:30:35,,,,,,,,,standard,$0",
      ",,,,2026-04-23 06:30:35,,,,,,,,,standard,$0",
    ].join("\n");
    const result = parseMembersCsv(csv);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.rows.length, 1);
    assert.equal(result.rejectedRows.length, 1);
    assert.equal(result.rejectedRows[0]?.reason, "no identifiable info");
  });

  it("ignores Question/Answer/Price/Recurring/Invited By columns silently", () => {
    const csv = [
      FULL_HEADER,
      "Sue,W,sue@example.com,Bill,2026-04-23 06:30:35,How did you find us?,Twitter,,,,,$10,month,Pro,$50",
    ].join("\n");
    const result = parseMembersCsv(csv);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const row = result.rows[0]!;
    assert.equal(row.firstName, "Sue");
    assert.equal(row.lastName, "W");
    assert.equal(row.email, "sue@example.com");
    assert.equal(row.tier, "Pro");
    assert.equal(row.ltv, 50);
    // None of the ignored columns leak onto the parsed row.
    assert.equal(Object.keys(row).sort().join(","), [
      "email",
      "firstName",
      "joinedAt",
      "lastName",
      "ltv",
      "name",
      "skoolMemberId",
      "tier",
    ].sort().join(","));
  });
});

describe("parseMembersCsv — failure modes", () => {
  it("fails when there are no identifying columns at all", () => {
    const csv = "Subscription,Notes\nPro,hello";
    const result = parseMembersCsv(csv);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.message, /no identifiable columns/i);
  });

  it("fails on empty input", () => {
    assert.equal(parseMembersCsv("").ok, false);
    assert.equal(parseMembersCsv("Email\n").ok, false);
  });

  it("enforces a max byte size", () => {
    const big = "Email\n" + "x@y.com\n".repeat(10);
    const result = parseMembersCsv(big, { maxBytes: 10 });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.message, /too large/i);
  });
});
