// ============================================================
// PeoplePulse — Next.js Middleware
// Clerk authentication + multi-tenant org resolution
// ============================================================

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getAuth, type ClerkClient } from "@clerk/nextjs/server";

// ---------------------------------------------------------------
// ROUTES THAT DON'T REQUIRE AUTH
// ---------------------------------------------------------------

const publicRoutes = [
  "/",
  "/login",
  "/signup",
  "/onboarding",
  "/api/trpc", // tRPC handles its own auth
  "/api/webhooks",
];

const isPublic = (pathname: string) =>
  publicRoutes.some((route) => pathname.startsWith(route));

// ---------------------------------------------------------------
// MIDDLEWARE
// ---------------------------------------------------------------

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Skip public routes
  if (isPublic(pathname)) {
    return NextResponse.next();
  }

  try {
    const { userId, orgId } = await getAuth(request);

    if (!userId) {
      // Not signed in — redirect to login
      const loginUrl = new URL("/login", request.url);
      loginUrl.searchParams.set("redirect_url", pathname);
      return NextResponse.redirect(loginUrl);
    }

    // User is authenticated — pass org context via headers for server components
    const response = NextResponse.next();

    if (orgId) {
      response.headers.set("x-org-id", orgId);
    }

    response.headers.set("x-user-id", userId);

    return response;
  } catch {
    // Clerk auth failed — redirect to login
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("redirect_url", pathname);
    return NextResponse.redirect(loginUrl);
  }
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization)
     * - favicon.ico (favicon)
     * - public folder
     */
    "/((?!_next/static|_next/image|favicon.ico|public).*)",
  ],
};