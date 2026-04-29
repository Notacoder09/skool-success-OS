"use server";

import { redirect } from "next/navigation";

import { signIn } from "@/auth";
import { isBetaEmailAllowed } from "@/lib/beta-access";

/** Magic-link send. Validates beta allowlist before calling Resend. */
export async function requestMagicLink(formData: FormData) {
  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();
  const fromRaw = String(formData.get("from") ?? "/today").trim();
  const redirectTo = fromRaw.startsWith("/") ? fromRaw : "/today";

  if (!email) return;

  if (!isBetaEmailAllowed(email)) {
    redirect("/sign-in?error=invite_only");
  }

  await signIn("resend", {
    email,
    redirectTo,
  });
}
