import { NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/auth";
import { db } from "@/db";
import { creators } from "@/db/schema/creators";
import { eq } from "drizzle-orm";

// IANA tz names: roughly /^[A-Za-z_+\-]+(?:\/[A-Za-z_+\-0-9]+)*$/.
// Full validation is done by the runtime (Intl.DateTimeFormat) below;
// the regex just rejects obviously malicious input.
const Body = z.object({
  timezone: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[A-Za-z][A-Za-z0-9_+\-]*(?:\/[A-Za-z0-9_+\-]+)*$/, "Invalid IANA timezone"),
});

function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const json = (await req.json().catch(() => null)) as unknown;
  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }
  const tz = parsed.data.timezone;
  if (!isValidTimezone(tz)) {
    return NextResponse.json({ error: "unknown_timezone" }, { status: 400 });
  }

  await db
    .update(creators)
    .set({ timezone: tz, updatedAt: new Date() })
    .where(eq(creators.userId, session.user.id));

  return NextResponse.json({ ok: true, timezone: tz });
}
