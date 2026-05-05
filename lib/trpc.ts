// ============================================================
// PeoplePulse — tRPC Context with Clerk Multi-Tenant Auth
// All routes protected; org context required for tenant isolation
// ============================================================

import { initTRPC, TRPCError } from "@trpc/server";
import { clerkClient } from "@clerk/nextjs/server";
import { prisma } from "./prisma";

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

export async function createContext(): Promise<Context> {
  try {
    const { auth } = await import("@clerk/nextjs/server");
    const { userId, orgId } = auth();

    if (!userId) {
      throw new TRPCError({ code: "UNAUTHORIZED", message: "Sign in required." });
    }

    const clerk = await clerkClient();
    const user = await clerk.users.getUser(userId);
    const userEmail = user.emailAddresses?.[0]?.emailAddress ?? "";

    const superAdminEmails = process.env.SUPER_ADMIN_EMAILS?.split(",") ?? [];
    const isSuperAdmin = superAdminEmails.includes(userEmail);

    if (isSuperAdmin) {
      return { auth: { id: userId, email: userEmail, name: user.fullName ?? userEmail, organizationId: null, orgRole: null, platformRole: "super_admin", isSuperAdmin: true }, prisma };
    }

    if (!orgId) {
      throw new TRPCError({ code: "FORBIDDEN", message: "No organization." });
    }

    const clerkOrg = await clerkClient().organizations.getOrganization({ organizationId: orgId });
    const publicMetadata = (clerkOrg.publicMetadata ?? {}) as Record<string, unknown>;
    const orgRole = (publicMetadata["appRole"] as string ?? "employee") as OrgRole;

    const dbOrg = await prisma.organization.findUnique({
      where: { clerkOrgId: orgId },
      select: { id: true, active: true },
    });

    if (!dbOrg) throw new TRPCError({ code: "NOT_FOUND", message: "Org not found." });
    if (!dbOrg.active) throw new TRPCError({ code: "FORBIDDEN", message: "Org suspended." });

    return { auth: { id: userId, email: userEmail, name: user.fullName ?? userEmail, organizationId: dbOrg.id, orgRole, platformRole: null, isSuperAdmin: false }, prisma };
  } catch (err: unknown) {
    if (err instanceof TRPCError) throw err;
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Auth error" });
  }
}

const t = initTRPC.context<Context>().create();

export const router = t.router;
export const publicProcedure = t.procedure;

export const protectedProcedure = t.procedure.use(async ({ ctx, next }) => {
  if (!ctx.auth) throw new TRPCError({ code: "UNAUTHORIZED" });
  return next({ ctx: { ...ctx, auth: ctx.auth } });
});

export const superAdminProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (!ctx.auth.isSuperAdmin) throw new TRPCError({ code: "FORBIDDEN", message: "Super Admin required." });
  return next();
});

export const orgProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (ctx.auth.isSuperAdmin) return next({ ctx: { ...ctx, auth: { ...ctx.auth, organizationId: null } } });
  if (!ctx.auth.organizationId) throw new TRPCError({ code: "FORBIDDEN", message: "Org required." });
  return next({ ctx });
});

export const requireRole = (...roles: OrgRole[]) =>
  orgProcedure.use(({ ctx, next }) => {
    if (!ctx.auth.orgRole || !roles.includes(ctx.auth.orgRole)) {
      throw new TRPCError({ code: "FORBIDDEN", message: `Requires: ${roles.join(", ")}` });
    }
    return next();
  });

export const requireAdminOrHR = requireRole("company_admin", "hr_manager");
export const requirePayrollOfficer = requireRole("company_admin", "hr_manager", "payroll_officer");
export const requireManager = requireRole("company_admin", "hr_manager", "payroll_officer", "line_manager");