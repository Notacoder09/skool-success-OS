"use server";

import { revalidatePath } from "next/cache";
import { and, eq, isNotNull, sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import { communities, members } from "@/db/schema/communities";
import { creators, skoolCredentials } from "@/db/schema/creators";
import { parseMembersCsv } from "@/lib/csv/members";
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
  let firstCourseTitle: string | null = null;
  try {
    const res = await client.listGroupCourses(groupId);
    firstCourseTitle =
      (res.courses[0]?.metadata?.title as string | undefined) ?? null;
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
      name: firstCourseTitle ?? null,
      isPrimary: true,
    })
    .onConflictDoUpdate({
      target: [communities.creatorId, communities.skoolGroupId],
      set: {
        name: firstCourseTitle ?? null,
      },
    });

  revalidatePath("/settings");
  revalidatePath("/today");
  revalidatePath("/drop-off");
  return { ok: true, communityName: firstCourseTitle };
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
      inserted: number;
      updated: number;
      enrichedWithSkoolId: number;
      totalRows: number;
      rejectedRows: number;
      skoolIdRowsForLaterSync: number;
    }
  | { ok: false; error: string };

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

  // Upsert each row. The `members` table has two possible unique keys
  // for a community: (skool_member_id) and (email). We dedupe by email
  // — that's what Skool exports always include and the CSV is the
  // canonical source of email truth. If a row also carries a Skool
  // member ID, we enrich the existing row so per-member progression
  // sync can pick it up next run.
  const now = new Date();
  let inserted = 0;
  let updated = 0;
  let enrichedWithSkoolId = 0;
  let skoolIdRowsForLaterSync = 0;

  for (const row of parsed.rows) {
    const existing = await db
      .select({
        id: members.id,
        skoolMemberId: members.skoolMemberId,
      })
      .from(members)
      .where(
        and(eq(members.communityId, community.id), eq(members.email, row.email)),
      );

    if (existing[0]) {
      const wasMissingSkoolId = !existing[0].skoolMemberId;
      const willHaveSkoolId =
        wasMissingSkoolId && row.skoolMemberId !== null;
      await db
        .update(members)
        .set({
          name: row.name ?? sql`name`, // keep existing name when CSV has none
          skoolMemberId: row.skoolMemberId ?? existing[0].skoolMemberId,
          joinedAt: row.joinedAt ?? sql`joined_at`,
          source: "csv",
          updatedAt: now,
        })
        .where(eq(members.id, existing[0].id));
      updated += 1;
      if (willHaveSkoolId) enrichedWithSkoolId += 1;
    } else {
      await db.insert(members).values({
        communityId: community.id,
        email: row.email,
        name: row.name,
        skoolMemberId: row.skoolMemberId,
        joinedAt: row.joinedAt,
        source: "csv",
        createdAt: now,
        updatedAt: now,
      });
      inserted += 1;
    }
    if (row.skoolMemberId) skoolIdRowsForLaterSync += 1;
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
