// ============================================================
// PeoplePulse — tRPC Configuration & Middleware
// Authentication scoped by Clerk orgId
// ============================================================

import { initTRPC, TRPCError } from "@trpc/server";
import { type NextRequest } from "next/server";
import { clerkClient } from "@clerk/nextjs/server";
import { prisma } from "./prisma";

// ---------------------------------------------------------------
// TYPES & CONTEXT
// ---------------------------------------------------------------

export type OrgRole =
  | "company_admin"
  | "hr_manager"
  | "payroll_officer"
  | "line_manager"
  | "employee";

export type PlatformRole = "super_admin";

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  organizationId: string | null;
  orgRole: OrgRole | null;
  platformRole: PlatformRole | null;
  isSuperAdmin: boolean;
}

export type Context = {
  auth: AuthUser;
  prisma: typeof prisma;
};

/**
 * Creates the tRPC context for each request.
 * Authenticates the user via Clerk and fetches their DB organization link.
 */
export async function createContext(req?: Request): Promise<Context> {
  try {
    const { auth } = await import("@clerk/nextjs/server");
    const { userId, orgId } = auth();

    if (!userId) {
      throw new TRPCError({ code: "UNAUTHORIZED", message: "Sign in required." });
    }

    const clerk = await clerkClient();
    const user = await clerk.users.getUser(userId);
    const userEmail = user.emailAddresses?.[0]?.emailAddress ?? "";

    // Check if user is a platform super admin (via email list in env)
    const superAdminEmails = process.env.SUPER_ADMIN_EMAILS?.split(",") ?? [];
    const isSuperAdmin = superAdminEmails.includes(userEmail);

    if (isSuperAdmin) {
      return {
        auth: {
          id: userId,
          email: userEmail,
          name: user.fullName ?? userEmail,
          organizationId: null,
          orgRole: null,
          platformRole: "super_admin",
          isSuperAdmin: true,
        },
        prisma,
      };
    }

    // Regular user must have an organization context for most operations
    if (!orgId) {
      throw new TRPCError({ code: "FORBIDDEN", message: "Organization selection required." });
    }

    // Get organization role from Clerk metadata
    const clerkOrg = await clerk.organizations.getOrganization({ organizationId: orgId });
    const publicMetadata = (clerkOrg.publicMetadata ?? {}) as Record<string, unknown>;
    const orgRole = (publicMetadata["appRole"] as string ?? "employee") as OrgRole;

    // Verify organization exists and is active in our DB
    const dbOrg = await prisma.organization.findUnique({
      where: { clerkOrgId: orgId },
      select: { id: true, active: true },
    });

    if (!dbOrg) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Organization not registered." });
    }

    if (!dbOrg.active) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Your organization account is suspended. Contact support.",
      });
    }

    return {
      auth: {
        id: userId,
        email: userEmail,
        name: user.fullName ?? userEmail,
        organizationId: dbOrg.id,
        orgRole,
        platformRole: null,
        isSuperAdmin: false,
      },
      prisma,
    };
  } catch (err: unknown) {
    if (err instanceof TRPCError) throw err;
    console.error("tRPC Context Error:", err);
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Authentication failed during context creation.",
    });
  }
}

// ---------------------------------------------------------------
// tRPC INITIALIZATION
// ---------------------------------------------------------------

const t = initTRPC.context<Context>().create();

export const router = t.router;
export const publicProcedure = t.procedure;

// Protected procedure — requires authentication
export const protectedProcedure = t.procedure.use(async ({ ctx, next }) => {
  if (!ctx.auth) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }
  return next({ ctx: { ...ctx, auth: ctx.auth } });
});

// Super Admin only
export const superAdminProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (!ctx.auth.isSuperAdmin) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Platform Super Admin access required.",
    });
  }
  return next();
});

// Org-scoped procedure — requires org membership (Company Admin / HR / Payroll / Manager / Employee)
export const orgProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (ctx.auth.isSuperAdmin) {
    // Super admin can access any org — pass null orgId
    return next({ ctx: { ...ctx, auth: { ...ctx.auth, organizationId: null } } });
  }
  if (!ctx.auth.organizationId) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Organization membership required.",
    });
  }
  return next({ ctx });
});

// Role-based middleware helpers
export const requireRole = (...roles: OrgRole[]) =>
  orgProcedure.use(({ ctx, next }) => {
    if (!ctx.auth.orgRole || !roles.includes(ctx.auth.orgRole)) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: `One of these roles required: ${roles.join(", ")}`,
      });
    }
    return next();
  });

// Shortcuts
export const requireAdminOrHR = requireRole("company_admin", "hr_manager");
export const requirePayrollOfficer = requireRole("company_admin", "hr_manager", "payroll_officer");
export const requireManager = requireRole("company_admin", "hr_manager", "payroll_officer", "line_manager");
