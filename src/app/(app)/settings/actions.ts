"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import { communities } from "@/db/schema/communities";
import { creators, skoolCredentials } from "@/db/schema/creators";
import { encrypt, serializeSkoolCookies, type SkoolCookies } from "@/lib/crypto";
import { requireSession } from "@/lib/server/creator";
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

  // Upsert the primary community row from what the verification call
  // returned. Course-tree sync runs as a separate job in Days 4-7.
  await db
    .insert(communities)
    .values({
      creatorId: creatorRow.id,
      skoolGroupId: groupId,
      name: firstCourseTitle ?? null,
      isPrimary: true,
      lastSyncedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [communities.creatorId, communities.skoolGroupId],
      set: {
        name: firstCourseTitle ?? null,
        lastSyncedAt: new Date(),
      },
    });

  revalidatePath("/settings");
  revalidatePath("/today");
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

// Decrypted-cookie loading lives in src/lib/server/skool-credentials.ts.
// It deliberately is NOT a server action — every function exported from
// a "use server" file is auto-exposed as a POST endpoint, and that helper
// takes a creator ID without authorizing the caller.
