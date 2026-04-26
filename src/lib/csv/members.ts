import Papa from "papaparse";
import { z } from "zod";

// Pure helpers for parsing a Skool members CSV. Skool's admin panel
// exports a CSV with at least name + email columns; some exports also
// include the member ID. Header casing varies, so we normalise to a
// canonical shape before importing.
//
// Pure (no DB, no env). Server action lives in
// src/app/(app)/settings/actions.ts.

// Aliases are stored in their POST-normalised form (lowercase, hyphens
// and spaces collapsed to underscores, all other punctuation stripped).
// Keep them in sync with the slug normaliser below.
export const HEADER_ALIASES: Record<string, string[]> = {
  email: ["email", "e_mail", "email_address", "emailaddress"],
  name: ["name", "full_name", "fullname", "display_name", "displayname"],
  skoolMemberId: ["member_id", "memberid", "skool_id", "skoolid", "id", "user_id", "userid"],
  joinedAt: ["joined", "joined_at", "joinedat", "join_date", "joindate", "created", "created_at"],
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SKOOL_UUID_RE = /^[a-f0-9]{32}$/;

export interface RawCsvRow {
  [key: string]: string | undefined;
}

export interface ParsedMemberRow {
  email: string;
  name: string | null;
  skoolMemberId: string | null;
  joinedAt: Date | null;
}

export interface ParsedCsv {
  rows: ParsedMemberRow[];
  totalRows: number;
  /** Rows we couldn't recover from — bad email, missing required fields. */
  rejectedRows: Array<{ rowNumber: number; reason: string }>;
  /** Maps our canonical name → the original CSV header we picked. */
  headerMap: Partial<Record<keyof ParsedMemberRow, string>>;
}

export interface ParseError {
  ok: false;
  message: string;
}

export type ParseResult =
  | ({ ok: true } & ParsedCsv)
  | ParseError;

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
  for (const [canonical, aliases] of Object.entries(HEADER_ALIASES)) {
    if (slug === canonical || aliases.includes(slug)) {
      return canonical as keyof typeof HEADER_ALIASES;
    }
  }
  return null;
}

const dateSchema = z.preprocess((val) => {
  if (typeof val !== "string" || val.trim() === "") return null;
  const d = new Date(val);
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

  if (!headerMap.email) {
    return {
      ok: false,
      message:
        "Couldn't find an email column. Expected a header like 'email' or 'Email Address'.",
    };
  }

  const rows: ParsedMemberRow[] = [];
  const rejectedRows: ParsedCsv["rejectedRows"] = [];
  const seenEmails = new Set<string>();

  rawRows.forEach((raw, idx) => {
    const rowNumber = idx + 2; // +1 for 0-index, +1 for header row
    const email = (raw[headerMap.email as string] ?? "").trim().toLowerCase();
    if (!email) {
      rejectedRows.push({ rowNumber, reason: "empty email" });
      return;
    }
    if (!EMAIL_RE.test(email)) {
      rejectedRows.push({ rowNumber, reason: "invalid email" });
      return;
    }
    if (seenEmails.has(email)) {
      rejectedRows.push({ rowNumber, reason: "duplicate email in CSV" });
      return;
    }
    seenEmails.add(email);

    const name = headerMap.name
      ? cleanString(raw[headerMap.name])
      : null;

    let skoolMemberId: string | null = null;
    if (headerMap.skoolMemberId) {
      const candidate = cleanString(raw[headerMap.skoolMemberId])?.toLowerCase() ?? null;
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

    rows.push({ email, name, skoolMemberId, joinedAt });
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
