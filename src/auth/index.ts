import { DrizzleAdapter } from "@auth/drizzle-adapter";
import NextAuth from "next-auth";
import type { NextAuthConfig } from "next-auth";
import Resend from "next-auth/providers/resend";

import { db } from "@/db";
import { accounts, sessions, users, verificationTokens } from "@/db/schema/auth";
import { creators } from "@/db/schema/creators";
import { sendEmail } from "@/lib/email";

import { buildMagicLinkEmail } from "./email-template";

// ADR-0002: NextAuth/Auth.js with magic link via Resend.
// We use Auth.js's built-in Resend provider but override
// sendVerificationRequest so the email matches the V2 design
// (terracotta accent, lowercase wordmark, one-paragraph copy).
//
// Production (Vercel) — set explicitly or sign-in blows up early with
// `/api/auth/error?error=Configuration`:
//   AUTH_SECRET — `openssl rand -base64 32`
//   AUTH_URL — canonical site origin only, HTTPS, NO trailing slash
//              (example: https://coursesuccess.io)
// @auth/core `assertConfig` requires trustHost === true behind reverse
// proxies; we set it in code instead of relying on env inference alone.

const fromAddress = process.env.RESEND_FROM ?? "CourseSuccess OS <onboarding@resend.dev>";

const authSecret = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET;

export const authConfig = {
  trustHost: true,
  secret: authSecret,
  adapter: DrizzleAdapter(db, {
    usersTable: users,
    accountsTable: accounts,
    sessionsTable: sessions,
    verificationTokensTable: verificationTokens,
  }),
  session: { strategy: "jwt" },
  pages: {
    signIn: "/sign-in",
    verifyRequest: "/sign-in/check-email",
  },
  providers: [
    Resend({
      // Explicit key + fallback to Auth.js env convention (AUTH_RESEND_KEY).
      apiKey:
        process.env.RESEND_API_KEY ?? process.env.AUTH_RESEND_KEY,
      from: fromAddress,
      maxAge: 10 * 60, // 10 minute single-use link
      async sendVerificationRequest({ identifier: email, url }) {
        const host = new URL(url).host;
        const message = buildMagicLinkEmail({ url, host });
        await sendEmail({
          to: email,
          subject: message.subject,
          html: message.html,
          text: message.text,
          tags: [{ name: "kind", value: "magic_link" }],
        });
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user?.id) {
        token.userId = user.id;
      }
      return token;
    },
    async session({ session, token }) {
      if (token.userId && session.user) {
        session.user.id = token.userId as string;
      }
      return session;
    },
  },
  events: {
    /**
     * Bootstrap a creator profile row the first time we see a user.
     * Keeps the Auth.js `users` table to its standard shape while our
     * domain table (`creators`) carries timezone, cohort, transcription
     * settings, etc.
     */
    async createUser({ user }) {
      if (!user.id) return;
      // Idempotent: if the row already exists (replays, races) skip.
      await db
        .insert(creators)
        .values({ userId: user.id })
        .onConflictDoNothing({ target: creators.userId });
    },
  },
} satisfies NextAuthConfig;

export const { handlers, auth, signIn, signOut } = NextAuth(authConfig);
