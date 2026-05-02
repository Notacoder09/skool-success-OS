"use server";

import { revalidatePath } from "next/cache";
import { and, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import { communities, members } from "@/db/schema/communities";
import { creators, skoolCredentials } from "@/db/schema/creators";
import { parseMembersCsv, type ParsedMemberRow } from "@/lib/csv/members";
import { encrypt, serializeSkoolCookies, type SkoolCookies } from "@/lib/crypto";
import { getPrimaryCommunity, requireSession } from "@/lib/server/creator";
import {
  SkoolAuthError,
  SkoolClient,
  SkoolNotFoundError,
  SkoolUpstreamError,
} from "@/lib/skool-api";

// ---------------------------------------------------------------------------
// Connect Skool (paste cookies + group id, verify, encrypt, store)
// ---------------------------------------------------------------------------

const ConnectSchema = z.object({
  authToken: z.string().min(20, "auth_token looks too short — copy the full JWT."),
  clientId: z.string().min(8, "client_id looks too short."),
  groupId: z
    .string()
    .min(8, "Paste your Skool group ID (32-char hex)")
    .max(64)
    .regex(/^[a-f0-9-]+$/i, "Group ID should be hex (no spaces)"),
});

export type ConnectResult =
  | { ok: true; communityName: string | null }
  | { ok: false; error: string; field?: keyof z.infer<typeof ConnectSchema> };

export async function connectSkool(formData: FormData): Promise<ConnectResult> {
  const session = await requireSession();

  const parsed = ConnectSchema.safeParse({
    authToken: formData.get("authToken"),
    clientId: formData.get("clientId"),
    groupId: formData.get("groupId"),
  });
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return {
      ok: false,
      error: issue?.message ?? "Invalid input.",
      field: issue?.path[0] as keyof z.infer<typeof ConnectSchema> | undefined,
    };
  }

  const { authToken, clientId, groupId } = parsed.data;

  // Live-verify the cookies before we store them. Hits the cheapest
  // working endpoint that requires both a valid session AND ownership
  // of the group: listing courses.
  const cookies: SkoolCookies = { authToken, clientId };
  const client = new SkoolClient({ cookies });
  let communityName: string | null = null;
  try {
    await client.listGroupCourses(groupId);
    const group = await client.getGroup(groupId);
    communityName = extractGroupName(group);
  } catch (err) {
    if (err instanceof SkoolAuthError) {
      return { ok: false, error: "Those cookies didn't work. Re-copy from Skool." };
    }
    if (err instanceof SkoolNotFoundError) {
      return {
        ok: false,
        error: "That group ID isn't visible to your account.",
        field: "groupId",
      };
    }
    if (err instanceof SkoolUpstreamError) {
      return {
        ok: false,
        error: `Skool returned an error (${err.status ?? "?"}). Try again in a moment.`,
      };
    }
    throw err;
  }

  // Fetch the creator row up front so we can scope writes to creator_id.
  const [creatorRow] = await db
    .select({ id: creators.id })
    .from(creators)
    .where(eq(creators.userId, session.userId));
  if (!creatorRow) {
    return {
      ok: false,
      error: "Account is missing a creator profile. Sign out and back in.",
    };
  }

  const blob = encrypt(serializeSkoolCookies(cookies));

  // Upsert credentials.
  await db
    .insert(skoolCredentials)
    .values({
      creatorId: creatorRow.id,
      ciphertext: blob.ciphertext,
      iv: blob.iv,
      authTag: blob.authTag,
      keyVersion: blob.keyVersion,
      status: "active",
      lastVerifiedAt: new Date(),
      lastFailureReason: null,
    })
    .onConflictDoUpdate({
      target: skoolCredentials.creatorId,
      set: {
        ciphertext: blob.ciphertext,
        iv: blob.iv,
        authTag: blob.authTag,
        keyVersion: blob.keyVersion,
        status: "active",
        lastVerifiedAt: new Date(),
        lastFailureReason: null,
        updatedAt: new Date(),
      },
    });

  // Upsert the primary community row. lastSyncedAt deliberately stays
  // null here — it gets set by syncCommunity() when a real sync run
  // completes. The Drop-Off Map page nudges the creator to "Refresh
  // now" if no sync has happened yet.
  await db
    .insert(communities)
    .values({
      creatorId: creatorRow.id,
      skoolGroupId: groupId,
      name: communityName,
      isPrimary: true,
    })
    .onConflictDoUpdate({
      target: [communities.creatorId, communities.skoolGroupId],
      set: {
        name: communityName,
      },
    });

  revalidatePath("/settings");
  revalidatePath("/today");
  revalidatePath("/drop-off");
  return { ok: true, communityName };
}

function extractGroupName(group: Record<string, unknown>): string | null {
  const candidate =
    readNonEmptyString(group["name"]) ??
    readNonEmptyString(group["group_name"]) ??
    readNonEmptyString(group["title"]) ??
    readNonEmptyString(group["display_name"]);
  return candidate ?? null;
}

function readNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

// ---------------------------------------------------------------------------
// Disconnect Skool (creator-initiated revocation; ADR-0003)
// ---------------------------------------------------------------------------

export async function disconnectSkool() {
  const session = await requireSession();

  const [creatorRow] = await db
    .select({ id: creators.id })
    .from(creators)
    .where(eq(creators.userId, session.userId));
  if (!creatorRow) return;

  await db
    .delete(skoolCredentials)
    .where(eq(skoolCredentials.creatorId, creatorRow.id));

  revalidatePath("/settings");
  revalidatePath("/today");
  revalidatePath("/drop-off");
}

// ---------------------------------------------------------------------------
// Toggle transcription opt-in (master plan Feature 2 default-OFF)
// ---------------------------------------------------------------------------

export async function setTranscriptionEnabled(enabled: boolean) {
  const session = await requireSession();
  await db
    .update(creators)
    .set({ transcriptionEnabled: enabled, updatedAt: new Date() })
    .where(eq(creators.userId, session.userId));
  revalidatePath("/settings");
}

// ---------------------------------------------------------------------------
// Import members from CSV (ADR-0004)
// ---------------------------------------------------------------------------

const MAX_CSV_BYTES = 5 * 1024 * 1024;

export type ImportMembersResult =
  | {
      ok: true;
      /** Total members imported (inserted + updated) — the headline number. */
      importedCount: number;
      inserted: number;
      updated: number;
      enrichedWithSkoolId: number;
      totalRows: number;
      rejectedRows: number;
      skoolIdRowsForLaterSync: number;
    }
  | { ok: false; error: string };

// Finds an existing member row for an incoming CSV row, walking the
// identity keys in descending order of confidence. Mirrors the
// dedupe logic in the parser (`seenIdentityKeys`) so DB state and
// CSV state agree on what constitutes "the same person".
async function findExistingMember(
  communityId: string,
  row: ParsedMemberRow,
): Promise<{ id: string; skoolMemberId: string | null } | null> {
  if (row.skoolMemberId) {
    const [byId] = await db
      .select({ id: members.id, skoolMemberId: members.skoolMemberId })
      .from(members)
      .where(
        and(
          eq(members.communityId, communityId),
          eq(members.skoolMemberId, row.skoolMemberId),
        ),
      );
    if (byId) return byId;
  }
  if (row.email) {
    const [byEmail] = await db
      .select({ id: members.id, skoolMemberId: members.skoolMemberId })
      .from(members)
      .where(
        and(
          eq(members.communityId, communityId),
          eq(members.email, row.email),
        ),
      );
    if (byEmail) return byEmail;
  }
  // No reliable key — try (community, name, joined_at) only when the
  // existing row also has no email. Two emailless rows with the same
  // name and the same join timestamp are almost certainly the same
  // member; if they aren't, the creator can re-export with emails.
  if (row.name) {
    const conditions = [
      eq(members.communityId, communityId),
      isNull(members.email),
      eq(members.name, row.name),
    ];
    if (row.joinedAt) {
      conditions.push(eq(members.joinedAt, row.joinedAt));
    } else {
      conditions.push(isNull(members.joinedAt));
    }
    const [byName] = await db
      .select({ id: members.id, skoolMemberId: members.skoolMemberId })
      .from(members)
      .where(and(...conditions));
    if (byName) return byName;
  }
  return null;
}

export async function importMembersFromCsv(
  formData: FormData,
): Promise<ImportMembersResult> {
  const session = await requireSession();

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return { ok: false, error: "No file uploaded." };
  }
  if (file.size === 0) {
    return { ok: false, error: "File is empty." };
  }
  if (file.size > MAX_CSV_BYTES) {
    return {
      ok: false,
      error: `File is too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Max 5 MB.`,
    };
  }

  const [creatorRow] = await db
    .select({ id: creators.id })
    .from(creators)
    .where(eq(creators.userId, session.userId));
  if (!creatorRow) {
    return { ok: false, error: "Sign in again — creator profile missing." };
  }

  const community = await getPrimaryCommunity(creatorRow.id);
  if (!community) {
    return {
      ok: false,
      error: "Connect Skool first so we know which community to import into.",
    };
  }

  const text = await file.text();
  const parsed = parseMembersCsv(text, { maxBytes: MAX_CSV_BYTES });
  if (!parsed.ok) {
    return { ok: false, error: parsed.message };
  }

  // Upsert each row. The members table has three possible identity
  // keys: (skool_member_id), (email), and — for emailless free
  // members from Skool's CSV export — (community, name, joined_at).
  // We try them in that order of confidence.
  //
  // source: "csv" is set on every row so the next sync run knows to
  // match these against any Skool API data we discover (ADR-0004).
  const now = new Date();
  let inserted = 0;
  let updated = 0;
  let enrichedWithSkoolId = 0;

  for (const row of parsed.rows) {
    const existing = await findExistingMember(community.id, row);

    const ltvValue =
      row.ltv !== null && Number.isFinite(row.ltv) ? String(row.ltv) : null;

    if (existing) {
      const wasMissingSkoolId = !existing.skoolMemberId;
      const willHaveSkoolId =
        wasMissingSkoolId && row.skoolMemberId !== null;
      await db
        .update(members)
        .set({
          // Keep DB-side values for fields the CSV row doesn't fill,
          // so re-importing a thinner CSV doesn't blow away earlier
          // richer data.
          name: row.name ?? sql`name`,
          email: row.email ?? sql`email`,
          skoolMemberId: row.skoolMemberId ?? existing.skoolMemberId,
          joinedAt: row.joinedAt ?? sql`joined_at`,
          tier: row.tier ?? sql`tier`,
          ltv: ltvValue ?? sql`ltv`,
          source: "csv",
          updatedAt: now,
        })
        .where(eq(members.id, existing.id));
      updated += 1;
      if (willHaveSkoolId) enrichedWithSkoolId += 1;
    } else {
      await db.insert(members).values({
        communityId: community.id,
        email: row.email,
        name: row.name,
        skoolMemberId: row.skoolMemberId,
        joinedAt: row.joinedAt,
        tier: row.tier,
        ltv: ltvValue,
        source: "csv",
        createdAt: now,
        updatedAt: now,
      });
      inserted += 1;
    }
  }

  // Tell the Drop-Off Map page to refetch — it'll see the new member
  // count next render. Per-lesson percentages need a sync run to flow,
  // which the page nudges the creator toward.
  revalidatePath("/settings");
  revalidatePath("/drop-off");
  revalidatePath("/today");

  // Sanity stat: how many members in this community now have a
  // Skool ID we can sync progression for? Useful for honest copy.
  const memberRows = await db
    .select({ id: members.id })
    .from(members)
    .where(
      and(
        eq(members.communityId, community.id),
        isNotNull(members.skoolMemberId),
      ),
    );

  return {
    ok: true,
    importedCount: inserted + updated,
    inserted,
    updated,
    enrichedWithSkoolId,
    totalRows: parsed.totalRows,
    rejectedRows: parsed.rejectedRows.length,
    skoolIdRowsForLaterSync: memberRows.length,
  };
}

// Decrypted-cookie loading lives in src/lib/server/skool-credentials.ts.
// It deliberately is NOT a server action — every function exported from
// a "use server" file is auto-exposed as a POST endpoint, and that helper
// takes a creator ID without authorizing the caller.
