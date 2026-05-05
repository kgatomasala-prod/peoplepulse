// ============================================================
// PeoplePulse — tRPC Leave Management Router
// Statutory minimums: Annual=15, Sick=14, Maternity=14 weeks,
// Paternity=3 days. Public holidays auto-excluded.
// ============================================================

import { z } from "zod";
import { router, orgProcedure, requireAdminOrHR, requireRole } from "../trpc";
import { TRPCError } from "@trpc/server";

const LeaveTypeEnum = z.enum([
  "ANNUAL", "SICK", "MATERNITY", "PATERNITY", "COMPASSIONATE", "STUDY", "UNPAID",
]);

const LeaveRequestStatusEnum = z.enum([
  "PENDING", "MANAGER_APPROVED", "HR_CONFIRMED", "APPROVED", "DECLINED", "CANCELLED",
]);

// ---------------------------------------------------------------
// HELPERS
// ---------------------------------------------------------------

/**
 * Calculate business days between two dates, excluding weekends
 * and Botswana public holidays.
 */
async function calculateBusinessDays(
  ctx: { prisma: typeof import("../../lib/prisma").prisma },
  startDate: Date,
  endDate: Date,
  orgId: string
): Promise<number> {
  let days = 0;
  const current = new Date(startDate);

  // Fetch public holidays for Botswana
  const holidays = await ctx.prisma.publicHoliday.findMany({
    where: { countryCode: "BW", active: true },
    select: { date: true },
  });

  const holidayDates = new Set(
    holidays.map((h) => h.date.toISOString().split("T")[0])
  );

  while (current <= endDate) {
    const dayOfWeek = current.getDay();
    const isoDate = current.toISOString().split("T")[0];

    // Skip weekends (Sat=6, Sun=0)
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
    // Skip public holidays
    const isHoliday = holidayDates.has(isoDate);

    if (!isWeekend && !isHoliday) {
      days++;
    }

    current.setDate(current.getDate() + 1);
  }

  return days;
}

/**
 * Get applicable leave policy for an employee (statutory or custom)
 */
async function getLeavePolicy(
  ctx: { prisma: typeof import("../../lib/prisma").prisma },
  orgId: string,
  leaveType: z.infer<typeof LeaveTypeEnum>
) {
  const policy = await ctx.prisma.leavePolicy.findUnique({
    where: { organizationId_type: { organizationId: orgId, type: leaveType } },
  });

  if (!policy) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: `No leave policy found for type: ${leaveType}`,
    });
  }

  return policy;
}

// ---------------------------------------------------------------
// SCHEMAS
// ---------------------------------------------------------------

const CreateLeaveRequestSchema = z.object({
  employeeId: z.string(),
  leaveType: LeaveTypeEnum,
  startDate: z.string(), // ISO date
  endDate: z.string(),  // ISO date
  reason: z.string().optional(),
});

const ApproveLeaveRequestSchema = z.object({
  requestId: z.string(),
  action: z.enum(["MANAGER_APPROVE", "HR_CONFIRM", "DECLINE"]),
  notes: z.string().optional(),
  declineReason: z.string().optional(),
  isOverride: z.boolean().default(false), // allow negative balance
});

// ---------------------------------------------------------------
// ROUTER
// ---------------------------------------------------------------

export const leaveRouter = router({
  // ─── List leave policies ──────────────────────────────────────
  listPolicies: orgProcedure.query(async ({ ctx }) => {
    const policies = await ctx.prisma.leavePolicy.findMany({
      where: { organizationId: ctx.auth.organizationId! },
      orderBy: { type: "asc" },
    });
    return policies;
  }),

  // ─── Create or update leave policy ────────────────────────────
  upsertPolicy: requireAdminOrHR
    .input(
      z.object({
        type: LeaveTypeEnum,
        daysPerYear: z.number().positive(),
        carryOverMax: z.number().min(0).default(0),
        isStatutory: z.boolean().default(false),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const orgId = ctx.auth.organizationId!;

      // Statutory maternity must be ≥ 14 weeks (98 days)
      if (input.type === "MATERNITY" && input.isStatutory && input.daysPerYear < 98) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Maternity leave cannot be less than the statutory minimum of 14 weeks (98 days).",
        });
      }

      const policy = await ctx.prisma.leavePolicy.upsert({
        where: {
          organizationId_type: { organizationId: orgId, type: input.type },
        },
        create: {
          organizationId: orgId,
          type: input.type,
          daysPerYear: input.daysPerYear,
          carryOverMax: input.carryOverMax,
          isStatutory: input.isStatutory,
        },
        update: {
          daysPerYear: input.daysPerYear,
          carryOverMax: input.carryOverMax,
          isStatutory: input.isStatutory,
        },
      });

      return { policyId: policy.id };
    }),

  // ─── Seed statutory leave policies for a new org ──────────────
  seedStatutoryPolicies: requireAdminOrHR.mutation(async ({ ctx }) => {
    const orgId = ctx.auth.organizationId!;

    const statutoryPolicies = [
      { type: "ANNUAL" as const, daysPerYear: 15, isStatutory: true },
      { type: "SICK" as const, daysPerYear: 14, isStatutory: true },
      { type: "MATERNITY" as const, daysPerYear: 98, isStatutory: true }, // 14 weeks
      { type: "PATERNITY" as const, daysPerYear: 3, isStatutory: true },
    ];

    for (const p of statutoryPolicies) {
      await ctx.prisma.leavePolicy.upsert({
        where: {
          organizationId_type: { organizationId: orgId, type: p.type },
        },
        create: { organizationId: orgId, ...p },
        update: { daysPerYear: p.daysPerYear, isStatutory: true },
      });
    }

    return { seeded: true };
  }),

  // ─── Get employee's leave balances ─────────────────────────────
  getBalances: orgProcedure
    .input(z.object({ employeeId: z.string() }))
    .query(async ({ ctx, input }) => {
      const balances = await ctx.prisma.leaveBalance.findMany({
        where: {
          employeeId: input.employeeId,
          employee: { organizationId: ctx.auth.organizationId! },
        },
        include: { policy: true },
      });

      return balances.map((b) => ({
        ...b,
        remaining: Number(b.accrued) + Number(b.carriedOver) - Number(b.used),
        policyName: b.policy.type,
      }));
    }),

  // ─── Submit leave request ─────────────────────────────────────
  submitRequest: orgProcedure
    .input(CreateLeaveRequestSchema)
    .mutation(async ({ ctx, input }) => {
      const orgId = ctx.auth.organizationId!;

      // Verify employee belongs to org
      const employee = await ctx.prisma.employee.findFirst({
        where: { id: input.employeeId, organizationId: orgId },
      });

      if (!employee) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Employee not found." });
      }

      // Get policy
      const policy = await getLeavePolicy(ctx, orgId, input.leaveType);

      // Calculate business days (excluding weekends + public holidays)
      const startDate = new Date(input.startDate);
      const endDate = new Date(input.endDate);

      if (startDate > endDate) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Start date must be before or equal to end date.",
        });
      }

      const daysRequested = await calculateBusinessDays(ctx, startDate, endDate, orgId);

      // Check maternity statutory minimum — 14 weeks non-configurable floor
      if (input.leaveType === "MATERNITY" && daysRequested > 98) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Maternity leave cannot exceed 14 weeks (98 days) as per statutory minimum.",
        });
      }

      // Check current balance
      const balance = await ctx.prisma.leaveBalance.findUnique({
        where: {
          employeeId_policyId: { employeeId: input.employeeId, policyId: policy.id },
        },
      });

      const currentRemaining = Number(balance?.remaining ?? 0);

      if (currentRemaining < daysRequested) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Insufficient leave balance. Requested: ${daysRequested} days, Remaining: ${currentRemaining} days.`,
        });
      }

      const request = await ctx.prisma.leaveRequest.create({
        data: {
          employeeId: input.employeeId,
          policyId: policy.id,
          startDate,
          endDate,
          daysRequested,
          reason: input.reason ?? null,
          status: "PENDING",
        },
      });

      return { requestId: request.id, daysRequested };
    }),

  // ─── Approve / decline leave request ─────────────────────────
  approveRequest: requireRole("company_admin", "hr_manager", "line_manager")
    .input(ApproveLeaveRequestSchema)
    .mutation(async ({ ctx, input }) => {
      const request = await ctx.prisma.leaveRequest.findFirst({
        where: {
          id: input.requestId,
          employee: { organizationId: ctx.auth.organizationId! },
        },
        include: {
          employee: true,
          policy: true,
        },
      });

      if (!request) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Leave request not found." });
      }

      if (input.action === "MANAGER_APPROVE") {
        if (request.status !== "PENDING") {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Cannot approve. Current status: ${request.status}`,
          });
        }

        await ctx.prisma.leaveRequest.update({
          where: { id: input.requestId },
          data: {
            status: "MANAGER_APPROVED",
            approvedBy: ctx.auth.id,
            approvedAt: new Date(),
            notes: input.notes ?? null,
          },
        });

        return { status: "MANAGER_APPROVED" };
      }

      if (input.action === "HR_CONFIRM") {
        if (request.status !== "MANAGER_APPROVED") {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `HR can only confirm manager-approved requests. Current status: ${request.status}`,
          });
        }

        // Check if override is needed (balance insufficient but admin forcing)
        if (!input.isOverride) {
          const balance = await ctx.prisma.leaveBalance.findUnique({
            where: {
              employeeId_policyId: {
                employeeId: request.employeeId,
                policyId: request.policyId,
              },
            },
          });

          const currentRemaining = Number(balance?.remaining ?? 0);
          if (currentRemaining < request.daysRequested) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "Insufficient balance. Use override flag to force-approve (admin only).",
            });
          }
        }

        // Update balance: deduct days
        const balance = await ctx.prisma.leaveBalance.findUnique({
          where: {
            employeeId_policyId: { employeeId: request.employeeId, policyId: request.policyId },
          },
        });

        await ctx.prisma.leaveBalance.update({
          where: {
            employeeId_policyId: { employeeId: request.employeeId, policyId: request.policyId },
          },
          data: {
            used: Number(balance?.used ?? 0) + request.daysRequested,
            remaining:
              Number(balance?.accrued ?? 0) +
              Number(balance?.carriedOver ?? 0) -
              Number(balance?.used ?? 0) -
              request.daysRequested,
          },
        });

        await ctx.prisma.leaveRequest.update({
          where: { id: input.requestId },
          data: {
            status: "APPROVED",
            HRConfirmedBy: ctx.auth.id,
            HRConfirmedAt: new Date(),
            isOverride: input.isOverride,
          },
        });

        return { status: "APPROVED", isOverride: input.isOverride };
      }

      if (input.action === "DECLINE") {
        await ctx.prisma.leaveRequest.update({
          where: { id: input.requestId },
          data: {
            status: "DECLINED",
            declinedBy: ctx.auth.id,
            declinedAt: new Date(),
            declineReason: input.declineReason ?? null,
          },
        });

        return { status: "DECLINED" };
      }
    }),

  // ─── List leave requests ───────────────────────────────────────
  listRequests: orgProcedure
    .input(
      z.object({
        employeeId: z.string().optional(),
        status: LeaveRequestStatusEnum.optional(),
        leaveType: LeaveTypeEnum.optional(),
        startDate: z.string().optional(),
        endDate: z.string().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const where: Record<string, unknown> = {
        employee: { organizationId: ctx.auth.organizationId! },
      };

      if (input.employeeId) where.employeeId = input.employeeId;
      if (input.status) where.status = input.status;
      if (input.leaveType) where.policy = { type: input.leaveType };
      if (input.startDate) where.startDate = { gte: new Date(input.startDate) };
      if (input.endDate) where.endDate = { lte: new Date(input.endDate) };

      const requests = await ctx.prisma.leaveRequest.findMany({
        where,
        include: {
          employee: { select: { id: true, firstName: true, lastName: true } },
          policy: { select: { type: true, daysPerYear: true } },
        },
        orderBy: { createdAt: "desc" },
      });

      return requests;
    }),

  // ─── Accrue annual leave (monthly for active employees) ───────
  accrueMonthlyLeave: requireAdminOrHR.mutation(async ({ ctx }) => {
    const orgId = ctx.auth.organizationId!;

    // Find all active employees
    const employees = await ctx.prisma.employee.findMany({
      where: { organizationId: orgId, status: "ACTIVE" },
      include: {
        leaveBalances: {
          include: { policy: true },
        },
      },
    });

    const annualPolicy = await ctx.prisma.leavePolicy.findUnique({
      where: {
        organizationId_type: { organizationId: orgId, type: "ANNUAL" },
      },
    });

    if (!annualPolicy) return { accrued: 0 };

    // Monthly accrual = annual_days / 12
    const monthlyAccrual = annualPolicy.daysPerYear / 12;

    for (const employee of employees) {
      const annualBalance = employee.leaveBalances.find(
        (b) => b.policy.type === "ANNUAL"
      );

      if (annualBalance) {
        await ctx.prisma.leaveBalance.update({
          where: { id: annualBalance.id },
          data: {
            accrued: Number(annualBalance.accrued) + monthlyAccrual,
            remaining:
              Number(annualBalance.accrued) +
              Number(annualBalance.carriedOver) -
              Number(annualBalance.used) +
              monthlyAccrual,
          },
        });
      }
    }

    return { accrued: monthlyAccrual, employeeCount: employees.length };
  }),

  // ─── Carry over unused leave at year end ──────────────────────
  carryOverLeave: requireAdminOrHR
    .input(
      z.object({
        employeeId: z.string(),
        policyId: z.string(),
        maxCarryOver: z.number().min(0),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const balance = await ctx.prisma.leaveBalance.findUnique({
        where: {
          employeeId_policyId: { employeeId: input.employeeId, policyId: input.policyId },
        },
      });

      if (!balance) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Leave balance not found." });
      }

      const remaining = Number(balance.accrued) + Number(balance.carriedOver) - Number(balance.used);
      const carriedOver = Math.min(remaining, input.maxCarryOver);

      await ctx.prisma.leaveBalance.update({
        where: { id: balance.id },
        data: {
          carriedOver,
          remaining: Number(balance.accrued) + carriedOver - Number(balance.used),
        },
      });

      return { carriedOver };
    }),
});
