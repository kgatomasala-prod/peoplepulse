// ============================================================
// PeoplePulse — tRPC Payroll Router
// BURS-Compliant 5-Band PAYE Engine
// ============================================================

import { z } from "zod";
import { router, protectedProcedure, orgProcedure, requirePayrollOfficer } from "../trpc";
import {
  calculatePayroll,
  calculateSeverance,
  calculateLeaveEncashment,
  calculateProRata,
  checkMinimumWage,
  SDL_EXEMPT_THRESHOLD,
  DAYS_PER_YEAR,
  type PayrollInput,
  type TaxBandInput,
} from "../payroll";
import { TRPCError } from "@trpc/server";

// ---------------------------------------------------------------
// SCHEMAS
// ---------------------------------------------------------------

const PayrollRunStatusEnum = z.enum([
  "DRAFT", "CALCULATED", "REVIEW", "APPROVED", "LOCKED", "REVERSED",
]);

const InitiatePayrollSchema = z.object({
  periodMonth: z.number().int().min(1).max(12),
  periodYear: z.number().int().min(2024),
});

const OverridePayrollLineSchema = z.object({
  lineId: z.string(),
  overrideGross: z.number().optional(),
  overrideNet: z.number().optional(),
  overridePaye: z.number().optional(),
  overrideReason: z.string().min(1),
});

// ---------------------------------------------------------------
// ROUTER
// ---------------------------------------------------------------

export const payrollRouter = router({
  // ─── Initiate a new payroll run ───────────────────────────────
  initiate: requirePayrollOfficer
    .input(InitiatePayrollSchema)
    .mutation(async ({ ctx, input }) => {
      const { periodMonth, periodYear } = input;
      const orgId = ctx.auth.organizationId!;

      // Check if run already exists for this period
      const existing = await ctx.prisma.payrollRun.findUnique({
        where: {
          organizationId_periodMonth_periodYear: {
            organizationId: orgId,
            periodMonth,
            periodYear,
          },
        },
      });

      if (existing) {
        throw new TRPCError({
          code: "CONFLICT",
          message: `Payroll run already exists for ${periodMonth}/${periodYear}. Use it or reverse it first.`,
        });
      }

      // Fetch org for SDL exempt check
      const org = await ctx.prisma.organization.findUnique({
        where: { id: orgId },
        select: { turnover: true, sdlExempt: true },
      });

      const run = await ctx.prisma.payrollRun.create({
        data: {
          organizationId: orgId,
          periodMonth,
          periodYear,
          status: "DRAFT",
        },
      });

      return { runId: run.id, periodMonth, periodYear };
    }),

  // ─── Pull active employees + calculate all payroll lines ──────
  calculate: requirePayrollOfficer
    .input(z.object({ runId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const { runId } = input;
      const orgId = ctx.auth.organizationId!;

      // Fetch the run
      const run = await ctx.prisma.payrollRun.findFirst({
        where: { id: runId, organizationId: orgId },
      });

      if (!run) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Payroll run not found." });
      }

      if (run.status !== "DRAFT" && run.status !== "CALCULATED") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Cannot recalculate a run with status: ${run.status}`,
        });
      }

      // Fetch org tax bands + SDL exempt status
      const org = await ctx.prisma.organization.findUnique({
        where: { id: orgId },
        select: {
          turnover: true,
          sdlExempt: true,
          employees: {
            where: { status: "ACTIVE" },
            include: {
              payComponentAssignments: {
                where: { isActive: true, effectiveTo: null },
                include: { payComponent: true },
              },
            },
          },
        },
      });

      const isSDLExempt = org!.turnover < SDL_EXEMPT_THRESHOLD || org!.sdlExempt;

      // Fetch tax bands for Botswana 2025
      const taxBands = await ctx.prisma.taxBand.findMany({
        where: {
          country: { code: "BW" },
          taxYear: 2025,
          residentStatus: "RESIDENT",
          active: true,
        },
        orderBy: { bandMin: "asc" },
      });

      const nonResTaxBands = await ctx.prisma.taxBand.findMany({
        where: {
          country: { code: "BW" },
          taxYear: 2025,
          residentStatus: "NON_RESIDENT",
          active: true,
        },
        orderBy: { bandMin: "asc" },
      });

      const bandMap: TaxBandInput[] = taxBands.map((b) => ({
        bandMin: Number(b.bandMin),
        bandMax: b.bandMax ? Number(b.bandMax) : null,
        ratePercent: Number(b.ratePercent),
        cumulativeTaxBelow: Number(b.cumulativeTaxBelow),
      }));

      const nonResBandMap: TaxBandInput[] = nonResTaxBands.map((b) => ({
        bandMin: Number(b.bandMin),
        bandMax: b.bandMax ? Number(b.bandMax) : null,
        ratePercent: Number(b.ratePercent),
        cumulativeTaxBelow: Number(b.cumulativeTaxBelow),
      }));

      // Delete any existing lines (re-calculation)
      await ctx.prisma.payrollLine.deleteMany({ where: { runId } });

      const lines: unknown[] = [];
      let totalGross = 0;
      let totalNet = 0;
      let totalPaye = 0;
      let totalSdl = 0;

      for (const employee of org!.employees) {
        const assignments = employee.payComponentAssignments;

        const preTaxPension = assignments
          .filter((a) => a.payComponent.isPreTaxDeduction && a.payComponent.name.toLowerCase().includes("pension"))
          .reduce((sum, a) => sum + a.amount, 0);

        const preTaxMedicalAid = assignments
          .filter((a) => a.payComponent.isPreTaxDeduction && a.payComponent.name.toLowerCase().includes("medical"))
          .reduce((sum, a) => sum + a.amount, 0);

        const postTaxDeductions = assignments
          .filter((a) => a.payComponent.type === "DEDUCTION" && !a.payComponent.isPreTaxDeduction)
          .reduce((sum, a) => sum + a.amount, 0);

        const overtimePay = 0; // overtime entered separately per period
        const bonusPay = 0;

        const payrollInput: PayrollInput = {
          basicSalary: Number(employee.basicSalary),
          allowances: assignments.filter((a) => a.payComponent.type === "EARNING"),
          overtimeHours: 0,
          bonusPay: 0,
          preTaxPension,
          preTaxMedicalAid,
          postTaxDeductions,
          employerPensionRate: Number(employee.pensionContributionRate),
        };

        const isResident = employee.taxStatus === "RESIDENT";
        const result = calculatePayroll(
          payrollInput,
          isResident ? bandMap : nonResBandMap,
          isResident,
          isSDLExempt,
          Number(employee.pensionContributionRate)
        );

        // Calculate YTD from previous locked runs
        const prevYtdRuns = await ctx.prisma.payrollRun.findMany({
          where: {
            organizationId: orgId,
            status: "LOCKED",
            periodYear: run.periodYear,
          },
          include: {
            lines: { where: { employeeId: employee.id } },
          },
        });

        let ytdGross = 0;
        let ytdPaye = 0;
        let ytdNet = 0;

        for (const prevRun of prevYtdRuns) {
          for (const line of prevRun.lines) {
            ytdGross += Number(line.grossPay);
            ytdPaye += Number(line.paye);
            ytdNet += Number(line.netPay);
          }
        }

        const line = await ctx.prisma.payrollLine.create({
          data: {
            runId,
            employeeId: employee.id,
            basicSalary: result.grossPay - result.totalAllowances,
            totalAllowances: result.totalAllowances,
            overtimePay: 0,
            bonusPay: 0,
            grossPay: result.grossPay,
            preTaxPension,
            preTaxMedicalAid,
            taxableIncome: result.taxableIncome,
            paye: result.paye,
            sdl: result.sdl,
            postTaxDeductions: result.totalDeductions,
            totalDeductions: result.totalDeductions,
            netPay: result.netPay,
            employerPension: result.employerPension,
            employerCost: result.employerCost,
            ytdGross: ytdGross + result.grossPay,
            ytdPaye: ytdPaye + result.paye,
            ytdNet: ytdNet + result.netPay,
          },
        });

        lines.push(line);
        totalGross += result.grossPay;
        totalNet += result.netPay;
        totalPaye += result.paye;
        totalSdl += result.sdl;
      }

      // Update run totals and status
      const updatedRun = await ctx.prisma.payrollRun.update({
        where: { id: runId },
        data: {
          status: "CALCULATED",
          totalGross,
          totalNet,
          totalPaye,
          totalSdl,
        },
      });

      return { runId: updatedRun.id, status: updatedRun.status, lineCount: lines.length };
    }),

  // ─── Get payroll lines for a run (for review) ─────────────────
  getRunLines: orgProcedure
    .input(z.object({ runId: z.string() }))
    .query(async ({ ctx, input }) => {
      const lines = await ctx.prisma.payrollLine.findMany({
        where: { runId: input.runId },
        include: {
          employee: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              employeeNumber: true,
              jobTitle: true,
              basicSalary: true,
            },
          },
        },
        orderBy: { employee: { lastName: "asc" } },
      });
      return lines;
    }),

  // ─── Override a specific payroll line (reason required) ────────
  overrideLine: requirePayrollOfficer
    .input(OverridePayrollLineSchema)
    .mutation(async ({ ctx, input }) => {
      const line = await ctx.prisma.payrollLine.findFirst({
        where: { id: input.lineId, run: { organizationId: ctx.auth.organizationId! } },
        include: { run: true },
      });

      if (!line) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Payroll line not found." });
      }

      if (line.run.status === "LOCKED" || line.run.status === "REVERSED") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Cannot override a locked or reversed payroll run.",
        });
      }

      const updated = await ctx.prisma.payrollLine.update({
        where: { id: input.lineId },
        data: {
          grossPay: input.overrideGross ?? line.grossPay,
          netPay: input.overrideNet ?? line.netPay,
          paye: input.overridePaye ?? line.paye,
        },
      });

      // Log override in audit log
      await ctx.prisma.auditLog.create({
        data: {
          organizationId: ctx.auth.organizationId!,
          userId: ctx.auth.id,
          userEmail: ctx.auth.email,
          action: "PAYROLL_LINE_OVERRIDE",
          entityType: "PayrollLine",
          entityId: input.lineId,
          changes: {
            before: {
              grossPay: line.grossPay,
              netPay: line.netPay,
              paye: line.paye,
            },
            after: {
              grossPay: input.overrideGross ?? line.grossPay,
              netPay: input.overrideNet ?? line.netPay,
              paye: input.overridePaye ?? line.paye,
              reason: input.overrideReason,
            },
          },
        },
      });

      return updated;
    }),

  // ─── Approve and lock payroll run ──────────────────────────────
  approve: requirePayrollOfficer
    .input(z.object({ runId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const run = await ctx.prisma.payrollRun.findFirst({
        where: { id: input.runId, organizationId: ctx.auth.organizationId! },
      });

      if (!run) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Payroll run not found." });
      }

      if (run.status !== "CALCULATED" && run.status !== "REVIEW") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Cannot approve a run with status: ${run.status}`,
        });
      }

      const updated = await ctx.prisma.payrollRun.update({
        where: { id: input.runId },
        data: {
          status: "LOCKED",
          approvedBy: ctx.auth.id,
          approvedAt: new Date(),
        },
      });

      await ctx.prisma.auditLog.create({
        data: {
          organizationId: ctx.auth.organizationId!,
          userId: ctx.auth.id,
          userEmail: ctx.auth.email,
          action: "PAYROLL_APPROVED",
          entityType: "PayrollRun",
          entityId: input.runId,
          changes: { periodMonth: run.periodMonth, periodYear: run.periodYear },
        },
      });

      return { runId: updated.id, status: updated.status };
    }),

  // ─── Reverse a payroll run (creates reversal run) ─────────────
  reverse: requirePayrollOfficer
    .input(z.object({ runId: z.string(), reason: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const run = await ctx.prisma.payrollRun.findFirst({
        where: { id: input.runId, organizationId: ctx.auth.organizationId! },
      });

      if (!run) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Payroll run not found." });
      }

      if (run.status !== "LOCKED") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Only locked payroll runs can be reversed.",
        });
      }

      // Create a reversal run with negative values
      const reversalRun = await ctx.prisma.payrollRun.create({
        data: {
          organizationId: ctx.auth.organizationId!,
          periodMonth: run.periodMonth,
          periodYear: run.periodYear,
          status: "LOCKED",
          approvedBy: ctx.auth.id,
          approvedAt: new Date(),
          notes: `Reversal of run ${run.id}. Reason: ${input.reason}`,
          reversalOfId: run.id,
        },
      });

      // Copy lines with negative values
      const originalLines = await ctx.prisma.payrollLine.findMany({
        where: { runId: run.id },
      });

      for (const line of originalLines) {
        await ctx.prisma.payrollLine.create({
          data: {
            runId: reversalRun.id,
            employeeId: line.employeeId,
            basicSalary: -line.basicSalary,
            totalAllowances: -line.totalAllowances,
            overtimePay: -line.overtimePay,
            bonusPay: -line.bonusPay,
            grossPay: -line.grossPay,
            preTaxPension: -line.preTaxPension,
            preTaxMedicalAid: -line.preTaxMedicalAid,
            taxableIncome: -line.taxableIncome,
            paye: -line.paye,
            sdl: -line.sdl,
            postTaxDeductions: -line.postTaxDeductions,
            totalDeductions: -line.totalDeductions,
            netPay: -line.netPay,
            employerPension: -line.employerPension,
            employerCost: -line.employerCost,
            ytdGross: line.ytdGross - line.grossPay * 2,
            ytdPaye: line.ytdPaye - line.paye * 2,
            ytdNet: line.ytdNet - line.netPay * 2,
          },
        });
      }

      // Mark original as reversed
      await ctx.prisma.payrollRun.update({
        where: { id: run.id },
        data: { status: "REVERSED" },
      });

      return { reversalRunId: reversalRun.id };
    }),

  // ─── Calculate severance for an employee ──────────────────────
  calculateSeverance: orgProcedure
    .input(
      z.object({
        employeeId: z.string(),
        yearsOfService: z.number(),
        monthsOfService: z.number(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const employee = await ctx.prisma.employee.findFirst({
        where: { id: input.employeeId, organizationId: ctx.auth.organizationId! },
      });

      if (!employee) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Employee not found." });
      }

      const result = calculateSeverance(
        Number(employee.basicSalary),
        input.yearsOfService,
        input.monthsOfService
      );

      return result;
    }),

  // ─── Calculate leave encashment ───────────────────────────────
  calculateLeaveEncashment: orgProcedure
    .input(
      z.object({
        employeeId: z.string(),
        unusedLeaveDays: z.number(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const employee = await ctx.prisma.employee.findFirst({
        where: { id: input.employeeId, organizationId: ctx.auth.organizationId! },
      });

      if (!employee) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Employee not found." });
      }

      const result = calculateLeaveEncashment(
        Number(employee.basicSalary),
        input.unusedLeaveDays
      );

      return { encashment: result };
    }),

  // ─── Check minimum wage compliance ─────────────────────────────
  checkMinimumWage: orgProcedure
    .input(z.object({ employeeId: z.string() }))
    .query(async ({ ctx, input }) => {
      const employee = await ctx.prisma.employee.findFirst({
        where: { id: input.employeeId, organizationId: ctx.auth.organizationId! },
      });

      if (!employee) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Employee not found." });
      }

      const isCompliant = checkMinimumWage(Number(employee.basicSalary));
      return { employeeId: employee.id, isCompliant, basicSalary: employee.basicSalary };
    }),

  // ─── Get payroll run history ───────────────────────────────────
  getRunHistory: orgProcedure
    .input(
      z.object({
        periodYear: z.number().optional(),
        status: PayrollRunStatusEnum.optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const where: Record<string, unknown> = { organizationId: ctx.auth.organizationId! };
      if (input.periodYear) where.periodYear = input.periodYear;
      if (input.status) where.status = input.status;

      const runs = await ctx.prisma.payrollRun.findMany({
        where,
        orderBy: [{ periodYear: "desc" }, { periodMonth: "desc" }],
        include: {
          lines: { select: { id: true } },
        },
      });

      return runs.map((r) => ({
        ...r,
        lineCount: r.lines.length,
        lines: undefined,
      }));
    }),
});
