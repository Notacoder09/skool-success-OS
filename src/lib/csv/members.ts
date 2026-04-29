import Papa from "papaparse";
import { z } from "zod";

// Pure helpers for parsing a Skool members CSV.
//
// Skool's admin export shape (locked-in via creator testing on
// 2026-04-27): FirstName, LastName, Email, Invited By, JoinedDate,
// Question1, Answer1, Question2, Answer2, Question3, Answer3, Price,
// Recurring Interval, Tier, LTV.
//
// Real-world quirks we have to absorb:
//   - Email is optional (Skool doesn't always have it; many free
//     members come in without an email on file). Rows without email
//     are still useful — they have name + tier + LTV + joinedDate.
//   - Most Question/Answer/Invited-By columns are empty.
//   - LTV ships with a leading "$" (e.g. "$0", "$49.00"). Strip it
//     and parse as numeric.
//   - JoinedDate is "YYYY-MM-DD HH:MM:SS" (no T, no timezone). Treat
//     as UTC so parsing is deterministic across runtime locales.
//
// We also still recognise the older "Email + Member ID" shape from
// 2025 Skool exports (and from creators who export via their own
// scripts). Headers are matched case/punctuation-insensitively, so
// `FirstName`, `First Name`, `first_name` all collapse onto the same
// canonical key.
//
// Pure (no DB, no env). Server action lives in
// src/app/(app)/settings/actions.ts.

// Aliases are stored in their POST-normalised form (lowercase, hyphens
// and spaces collapsed to underscores, all other punctuation stripped).
// Keep them in sync with the slug normaliser below.
export const HEADER_ALIASES: Record<string, string[]> = {
  email: ["email", "e_mail", "email_address", "emailaddress"],
  // "name" matches when the export has a single combined name column.
  // FirstName/LastName below take precedence when both are present.
  name: ["name", "full_name", "fullname", "display_name", "displayname"],
  firstName: ["firstname", "first_name", "given_name", "givenname"],
  lastName: ["lastname", "last_name", "family_name", "surname"],
  skoolMemberId: [
    "member_id",
    "memberid",
    "skool_id",
    "skoolid",
    "id",
    "user_id",
    "userid",
  ],
  joinedAt: [
    "joined",
    "joined_at",
    "joinedat",
    "join_date",
    "joindate",
    "joineddate",
    "joined_date",
    "created",
    "created_at",
  ],
  tier: ["tier", "membership_tier", "membershiptier", "membership", "plan"],
  ltv: ["ltv", "lifetime_value", "lifetimevalue"],
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SKOOL_UUID_RE = /^[a-f0-9]{32}$/;
// Skool's CSV uses "YYYY-MM-DD HH:MM:SS" with no T separator and no
// timezone. We treat it as UTC for predictable parsing.
const SKOOL_DATE_RE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;

export interface RawCsvRow {
  [key: string]: string | undefined;
}

export interface ParsedMemberRow {
  /** Lowercased email. Null when the export row didn't have one. */
  email: string | null;
  /**
   * Display name. Built from FirstName + LastName when both columns
   * are present; otherwise falls back to a single-column name field.
   */
  name: string | null;
  firstName: string | null;
  lastName: string | null;
  skoolMemberId: string | null;
  joinedAt: Date | null;
  /** "standard", "Pro", "Founding member" — verbatim from the CSV. */
  tier: string | null;
  /** Lifetime value as a number. "$49.00" → 49.00. */
  ltv: number | null;
}

export interface ParsedCsv {
  rows: ParsedMemberRow[];
  totalRows: number;
  /** Rows we couldn't recover from — no name, no email, no Skool ID. */
  rejectedRows: Array<{ rowNumber: number; reason: string }>;
  /** Maps our canonical name → the original CSV header we picked. */
  headerMap: Partial<Record<keyof ParsedMemberRow, string>>;
}

export interface ParseError {
  ok: false;
  message: string;
}

export type ParseResult = ({ ok: true } & ParsedCsv) | ParseError;

// Normalise a CSV header into our canonical key, or return null if we
// don't recognise it. Case + whitespace + punctuation insensitive.
export function canonicaliseHeader(
  header: string,
): keyof typeof HEADER_ALIASES | null {
  const slug = header
    .trim()
    .toLowerCase()
    .replace(/[\s\-]+/g, "_")
    .replace(/[^a-z0-9_]/g, "");
  if (slug.length === 0) return null;
  for (const [canonical, aliases] of Object.entries(HEADER_ALIASES)) {
    // Compare against canonical-as-lowercase too, so `email` matches
    // `email` directly. camelCase canonicals (skoolMemberId) only ever
    // match via the alias list.
    if (slug === canonical.toLowerCase() || aliases.includes(slug)) {
      return canonical as keyof typeof HEADER_ALIASES;
    }
  }
  return null;
}

const dateSchema = z.preprocess((val) => {
  if (typeof val !== "string") return null;
  const trimmed = val.trim();
  if (trimmed === "") return null;
  // Coerce Skool's "YYYY-MM-DD HH:MM:SS" into ISO-8601 UTC. Other
  // formats (plain dates, ISO with timezone) pass straight through to
  // the Date constructor.
  const candidate = SKOOL_DATE_RE.test(trimmed)
    ? trimmed.replace(" ", "T") + "Z"
    : trimmed;
  const d = new Date(candidate);
  return Number.isNaN(d.getTime()) ? null : d;
}, z.date().nullable());

export interface ParseOptions {
  /** Default 5 MB. Skool CSVs for large groups are still well under 1 MB. */
  maxBytes?: number;
}

export function parseMembersCsv(
  text: string,
  opts: ParseOptions = {},
): ParseResult {
  const maxBytes = opts.maxBytes ?? 5 * 1024 * 1024;
  const byteLength = Buffer.byteLength(text, "utf8");
  if (byteLength === 0) {
    return { ok: false, message: "CSV is empty." };
  }
  if (byteLength > maxBytes) {
    return {
      ok: false,
      message: `CSV is too large (${(byteLength / 1024 / 1024).toFixed(1)} MB). Max ${(maxBytes / 1024 / 1024).toFixed(0)} MB.`,
    };
  }

  const parsed = Papa.parse<RawCsvRow>(text.trim(), {
    header: true,
    skipEmptyLines: true,
    // Default to comma. Papa's auto-detect throws a warning on
    // single-column CSVs (no delimiter to find), which we'd otherwise
    // mis-classify as a hard error.
    delimiter: ",",
    transformHeader: (h) => h.trim(),
  });

  if (parsed.errors.length > 0) {
    // PapaParse surfaces row-level "warnings" (extra/missing fields,
    // delimiter ambiguity) as errors. We only treat genuine parse
    // failures as fatal; everything else is captured per-row below.
    const NONFATAL_CODES = new Set([
      "TooFewFields",
      "TooManyFields",
      "UndetectableDelimiter",
    ]);
    const first = parsed.errors.find((e) => !NONFATAL_CODES.has(e.code));
    if (first) {
      return { ok: false, message: `CSV parse error: ${first.message}` };
    }
  }

  const rawRows = parsed.data.filter((r) => Object.keys(r).length > 0);
  if (rawRows.length === 0) {
    return { ok: false, message: "CSV has no data rows." };
  }

  const headers = Object.keys(rawRows[0] ?? {});
  const headerMap: Partial<Record<keyof ParsedMemberRow, string>> = {};
  for (const h of headers) {
    const canonical = canonicaliseHeader(h);
    if (canonical && !headerMap[canonical as keyof ParsedMemberRow]) {
      headerMap[canonical as keyof ParsedMemberRow] = h;
    }
  }

  // We need *some* identifying column. Email, FirstName, LastName, or
  // a single combined name column will all do. Without any of those
  // we can't distinguish rows from each other or persist meaningfully.
  const hasIdentityColumn =
    headerMap.email ||
    headerMap.firstName ||
    headerMap.lastName ||
    headerMap.name ||
    headerMap.skoolMemberId;
  if (!hasIdentityColumn) {
    return {
      ok: false,
      message:
        "CSV has no identifiable columns. Expected at least one of: Email, FirstName, LastName, Name, or Member ID.",
    };
  }

  const rows: ParsedMemberRow[] = [];
  const rejectedRows: ParsedCsv["rejectedRows"] = [];
  const seenEmails = new Set<string>();
  const seenIdentityKeys = new Set<string>();

  rawRows.forEach((raw, idx) => {
    const rowNumber = idx + 2; // +1 for 0-index, +1 for header row

    let email: string | null = null;
    if (headerMap.email) {
      const candidate = (raw[headerMap.email] ?? "").trim().toLowerCase();
      if (candidate.length > 0) {
        if (!EMAIL_RE.test(candidate)) {
          rejectedRows.push({ rowNumber, reason: "invalid email" });
          return;
        }
        if (seenEmails.has(candidate)) {
          rejectedRows.push({ rowNumber, reason: "duplicate email in CSV" });
          return;
        }
        seenEmails.add(candidate);
        email = candidate;
      }
    }

    const firstName = headerMap.firstName
      ? cleanString(raw[headerMap.firstName])
      : null;
    const lastName = headerMap.lastName
      ? cleanString(raw[headerMap.lastName])
      : null;

    // Display name: prefer "Name" column when present, else combine
    // FirstName + LastName. Trim any trailing/leading whitespace if
    // one half is missing.
    let name: string | null = headerMap.name
      ? cleanString(raw[headerMap.name])
      : null;
    if (!name && (firstName || lastName)) {
      name = [firstName, lastName].filter((s): s is string => !!s).join(" ");
      if (name.length === 0) name = null;
    }

    let skoolMemberId: string | null = null;
    if (headerMap.skoolMemberId) {
      const candidate =
        cleanString(raw[headerMap.skoolMemberId])?.toLowerCase() ?? null;
      if (candidate && SKOOL_UUID_RE.test(candidate)) {
        skoolMemberId = candidate;
      }
      // Silently drop non-UUID values — Skool exports sometimes include
      // a numeric "row id" we don't want polluting the column.
    }

    let joinedAt: Date | null = null;
    if (headerMap.joinedAt) {
      const result = dateSchema.safeParse(raw[headerMap.joinedAt]);
      if (result.success) joinedAt = result.data;
    }

    const tier = headerMap.tier ? cleanString(raw[headerMap.tier]) : null;
    const ltv = headerMap.ltv ? parseLtv(raw[headerMap.ltv]) : null;

    // Reject totally identity-less rows (all the columns we use are
    // empty). This catches blank rows + rows with only Question/Answer
    // junk.
    if (!email && !skoolMemberId && !name) {
      rejectedRows.push({ rowNumber, reason: "no identifiable info" });
      return;
    }

    // For rows without email, dedupe within the CSV by name +
    // joinedAt. Two rows with the same name on the same exact second
    // is ~certainly a duplicate; if it isn't, the creator can re-import
    // with emails.
    if (!email) {
      const key = `${(name ?? "").toLowerCase()}|${joinedAt?.toISOString() ?? ""}`;
      if (seenIdentityKeys.has(key)) {
        rejectedRows.push({
          rowNumber,
          reason: "duplicate name+joined date in CSV",
        });
        return;
      }
      seenIdentityKeys.add(key);
    }

    rows.push({
      email,
      name,
      firstName,
      lastName,
      skoolMemberId,
      joinedAt,
      tier,
      ltv,
    });
  });

  if (rows.length === 0) {
    return {
      ok: false,
      message: `Every row was rejected (${rejectedRows.length} bad). Check the CSV format.`,
    };
  }

  return {
    ok: true,
    rows,
    totalRows: rawRows.length,
    rejectedRows,
    headerMap,
  };
}

function cleanString(s: string | undefined): string | null {
  if (typeof s !== "string") return null;
  const trimmed = s.trim();
  return trimmed.length > 0 ? trimmed : null;
}

// Strip currency / formatting characters and parse as a number.
// Accepts "$0", "$49.00", "1,234.56", "0", "". Returns null when the
// value can't be parsed cleanly so we don't silently store NaN.
export function parseLtv(s: string | undefined): number | null {
  if (typeof s !== "string") return null;
  const trimmed = s.trim();
  if (trimmed.length === 0) return null;
  const cleaned = trimmed.replace(/[\s$,]/g, "");
  if (cleaned.length === 0) return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return null;
  // Round to 2 decimals — DB column is numeric(10,2). Anything more
  // precise gets truncated by Postgres anyway.
  return Math.round(n * 100) / 100;
}
