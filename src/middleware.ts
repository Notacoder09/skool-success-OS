import { NextResponse } from "next/server";

import { auth } from "@/auth";

// Public routes that never require a session. Anything not listed here
// is gated for signed-in creators.
const PUBLIC_PATHS = [
  "/", // marketing landing
  "/sign-in",
  "/sign-in/check-email",
];

const PUBLIC_PREFIXES = [
  "/api/auth",
  "/help",
  "/_next",
  "/favicon.ico",
  "/assets",
];

export default auth((req) => {
  const { pathname } = req.nextUrl;
  const isPublic =
    PUBLIC_PATHS.includes(pathname) ||
    PUBLIC_PREFIXES.some((prefix) => pathname.startsWith(prefix));

  if (isPublic) return NextResponse.next();

  if (!req.auth) {
    const signInUrl = new URL("/sign-in", req.nextUrl.origin);
    signInUrl.searchParams.set("from", pathname);
    return NextResponse.redirect(signInUrl);
  }

  return NextResponse.next();
});

export const config = {
  // Run on everything except static assets and the auth API itself.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
