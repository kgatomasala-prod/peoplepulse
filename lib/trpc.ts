// ============================================================
// PeoplePulse — tRPC Context with Clerk Multi-Tenant Auth
// All routes protected; org context required for tenant isolation
// ============================================================

import { initTRPC, TRPCError } from "@trpc/server";
import { type NextRequest } from "next/server";
import { clerkClient, type ClerkSharedUser } from "@clerk/nextjs/server";
import { prisma } from "./prisma";

// ---------------------------------------------------------------
// TYPES
// ---------------------------------------------------------------

export type OrgRole =
  | "company_admin"
  | "hr_manager"
  | "payroll_officer"
  | "line_manager"
  | "employee";

export type PlatformRole = "super_admin";

export interface AuthUser {
  id: string;              // Clerk user ID
  email: string;
  name: string;
  organizationId: string | null; // null for super_admin
  orgRole: OrgRole | null;
  platformRole: PlatformRole | null;
  isSuperAdmin: boolean;
}

// ---------------------------------------------------------------
// CONTEXT FACTORY
// ---------------------------------------------------------------

export type Context = {
  auth: AuthUser;
  prisma: typeof prisma;
};

export async function createContext(req: NextRequest): Promise<Context> {
  // Get auth state from Clerk — in middleware Clerk attaches to headers
  // For API routes, we use getAuth() from @clerk/nextjs/server
  const { auth } = await import("@clerk/nextjs/server");
  const { userId, orgId } = auth();

  if (!userId) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "You must be signed in to access PeoplePulse.",
    });
  }

  // Fetch user details from Clerk
  let user: ClerkSharedUser | null = null;
  try {
    const clerk = await clerkClient();
    user = await clerk.users.getUser(userId);
  } catch {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Failed to fetch user details.",
    });
  }

  // Determine platform-level super admin (list stored in env)
  const superAdminEmails = process.env.SUPER_ADMIN_EMAILS?.split(",") ?? [];
  const userEmail = user.emailAddresses?.[0]?.emailAddress ?? "";
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

  // Non-super-admin: must have an org context
  if (!orgId) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "You do not belong to an organization. Please create or join an organization.",
    });
  }

  // Fetch org role from Clerk public metadata
  const clerkOrg = await clerkClient().organizations.getOrganization({ organizationId: orgId });
  const publicMetadata = (clerkOrg.publicMetadata ?? {}) as Record<string, unknown>;

  // Map Clerk role to app role
  const rawRole = (publicMetadata["appRole"] as string | undefined) ?? "employee";
  const orgRole = rawRole as OrgRole;

  // Verify org exists in our database
  const dbOrg = await prisma.organization.findUnique({
    where: { clerkOrgId: orgId },
    select: { id: true, active: true },
  });

  if (!dbOrg) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Your organization has not been set up in PeoplePulse.",
    });
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

export const requireAdminOrHR = requireRole("company_admin", "hr_manager");
export const requirePayrollOfficer = requireRole("company_admin", "hr_manager", "payroll_officer");
export const requireManager = requireRole("company_admin", "hr_manager", "payroll_officer", "line_manager");