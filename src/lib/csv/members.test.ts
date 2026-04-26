import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { canonicaliseHeader, parseMembersCsv } from "./members";

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

  it("returns null for unknown headers", () => {
    assert.equal(canonicaliseHeader("Subscription Plan"), null);
    assert.equal(canonicaliseHeader(""), null);
  });
});

describe("parseMembersCsv", () => {
  it("parses a basic Skool-shaped CSV", () => {
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
    assert.deepEqual(result.headerMap, {
      email: "Email",
      name: "Name",
      joinedAt: "Joined",
    });
    assert.equal(result.rows[0]?.email, "bill@example.com");
    assert.equal(result.rows[0]?.name, "Bill T");
    assert.equal(result.rows[0]?.joinedAt?.toISOString(), "2026-01-01T00:00:00.000Z");
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
    assert.equal(result.rows[0]?.skoolMemberId, "a7c8f33668dc4bd49d4306c5c1ac3f12");
    assert.equal(result.rows[1]?.skoolMemberId, "90d98eb5a4774afbbde9559d4c7a0291");
  });

  it("drops non-UUID 'IDs' silently (Skool sometimes exports row indexes)", () => {
    const csv = "Email,Member ID\nx@y.com,42";
    const result = parseMembersCsv(csv);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.rows[0]?.skoolMemberId, null);
  });

  it("rejects rows with invalid or empty emails", () => {
    const csv = [
      "Name,Email",
      "OK,ok@example.com",
      "Bad,not-an-email",
      "Empty,",
    ].join("\n");
    const result = parseMembersCsv(csv);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.rows.length, 1);
    assert.equal(result.rejectedRows.length, 2);
    assert.equal(result.rejectedRows[0]?.reason, "invalid email");
    assert.equal(result.rejectedRows[1]?.reason, "empty email");
  });

  it("dedupes by email within the CSV", () => {
    const csv = [
      "Email",
      "x@y.com",
      "X@Y.com", // case insensitive
    ].join("\n");
    const result = parseMembersCsv(csv);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.rows.length, 1);
    assert.equal(result.rejectedRows[0]?.reason, "duplicate email in CSV");
  });

  it("fails fast when no email column is present", () => {
    const csv = "Name,Subscription\nA,Pro";
    const result = parseMembersCsv(csv);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.message, /email column/);
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
