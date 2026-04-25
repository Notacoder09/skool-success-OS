import { eq } from "drizzle-orm";

import { auth } from "@/auth";
import { db } from "@/db";
import { creators } from "@/db/schema/creators";
import { skoolCredentials } from "@/db/schema/creators";
import { communities } from "@/db/schema/communities";

// Server-only helpers that resolve "the current creator" from the
// session and load the small set of fields a page needs. Pages should
// reach for these instead of constructing ad-hoc joins.

export type CurrentCreator = {
  userId: string;
  email: string;
  creatorId: string;
  timezone: string;
  cohort: typeof creators.$inferSelect.cohort;
  transcriptionEnabled: boolean;
  transcriptionMinutesQuota: number;
};

export async function requireSession() {
  const session = await auth();
  if (!session?.user?.id || !session.user.email) {
    throw new Error("not_authenticated");
  }
  return { userId: session.user.id, email: session.user.email };
}

export async function getCurrentCreator(): Promise<CurrentCreator | null> {
  const session = await auth();
  if (!session?.user?.id || !session.user.email) return null;

  const [row] = await db.select().from(creators).where(eq(creators.userId, session.user.id));
  if (!row) return null;

  return {
    userId: session.user.id,
    email: session.user.email,
    creatorId: row.id,
    timezone: row.timezone,
    cohort: row.cohort,
    transcriptionEnabled: row.transcriptionEnabled,
    transcriptionMinutesQuota: row.transcriptionMinutesQuota,
  };
}

export type SkoolConnectionStatus = {
  connected: boolean;
  status: typeof skoolCredentials.$inferSelect.status | null;
  lastVerifiedAt: Date | null;
  lastFailureReason: string | null;
};

export async function getSkoolConnection(creatorId: string): Promise<SkoolConnectionStatus> {
  const [row] = await db
    .select({
      status: skoolCredentials.status,
      lastVerifiedAt: skoolCredentials.lastVerifiedAt,
      lastFailureReason: skoolCredentials.lastFailureReason,
    })
    .from(skoolCredentials)
    .where(eq(skoolCredentials.creatorId, creatorId));

  if (!row) {
    return {
      connected: false,
      status: null,
      lastVerifiedAt: null,
      lastFailureReason: null,
    };
  }
  return {
    connected: row.status === "active",
    status: row.status,
    lastVerifiedAt: row.lastVerifiedAt,
    lastFailureReason: row.lastFailureReason,
  };
}

export async function getPrimaryCommunity(creatorId: string) {
  const [row] = await db
    .select()
    .from(communities)
    .where(eq(communities.creatorId, creatorId))
    .limit(1);
  return row ?? null;
}
