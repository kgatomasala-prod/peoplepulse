// ============================================================
// PeoplePulse — Clerk Authentication Middleware
// Org-based multi-tenancy with role mapping
// ============================================================

import { clerkClient } from "@clerk/nextjs/server";
import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

// Public routes (no auth required)
const PUBLIC_ROUTES = ["/", "/login", "/signup", "/onboarding"];

export default auth(async (req) => {
  const { userId, orgId } = await auth();
  const pathname = req.nextUrl.pathname;

  // ─── Webhook handler (Clerk webhooks) ───────────────────────────
  if (pathname.startsWith("/api/webhooks/clerk")) {
    return NextResponse.next();
  }

  // ─── Public routes ───────────────────────────────────────────────
  const isPublic = PUBLIC_ROUTES.some(
    (r) => pathname === r || pathname.startsWith(`${r}/`)
  );
  if (isPublic) return NextResponse.next();

  // ─── All other routes require authentication ─────────────────────
  if (!userId) {
    const signIn = new URL("/login", req.url);
    signIn.searchParams.set("redirect_url", pathname);
    return NextResponse.redirect(signIn);
  }

  // ─── Super Admin route protection ────────────────────────────────
  if (pathname.startsWith("/super-admin")) {
    const superAdmins = (process.env.SUPER_ADMIN_EMAILS ?? "").split(",").filter(Boolean);
    const user = await clerkClient().users.getUser(userId);
    const email = user.emailAddresses?.[0]?.emailAddress ?? "";

    if (!superAdmins.includes(email)) {
      return NextResponse.redirect(new URL("/unauthorized", req.url));
    }
    return NextResponse.next();
  }

  // ─── Post-signup: no org yet → force onboarding ──────────────────
  if (!orgId) {
    if (!pathname.startsWith("/onboarding") && !pathname.startsWith("/api/")) {
      return NextResponse.redirect(new URL("/onboarding", req.url));
    }
    return NextResponse.next();
  }

  return NextResponse.next();
});

export const config = {
  matcher: [
    // Skip Next.js internals and all static files
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};