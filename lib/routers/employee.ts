// ============================================================
// PeoplePulse — tRPC Employee Router
// Full CRUD with 18+ DOB enforcement, Omang uniqueness, alerts
// ============================================================

import { z } from "zod";
import { router, orgProcedure, requireAdminOrHR, requireRole } from "../trpc";
import { TRPCError } from "@trpc/server";
import { checkMinimumWage } from "../payroll";

// ---------------------------------------------------------------
// SCHEMAS
// ---------------------------------------------------------------

const EmploymentTypeEnum = z.enum([
  "PERMANENT", "FIXED_TERM", "CASUAL", "PART_TIME", "PROBATIONARY",
]);

const EmployeeStatusEnum = z.enum([
  "ACTIVE", "ON_LEAVE", "SUSPENDED", "TERMINATED", "RESIGNED",
]);

const TaxStatusEnum = z.enum(["RESIDENT", "NON_RESIDENT"]);

const BankNameEnum = z.enum([
  "BANCABC", "FNB", "STANDARD_CHARTERED", "STANBIC", "CAPITEC", "NATIONAL_BANK",
]);

const CreateEmployeeSchema = z.object({
  branchId: z.string().optional(),
  departmentId: z.string().optional(),
  employeeNumber: z.string().min(1).max(20),

  // Personal
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100),
  dateOfBirth: z.string(), // ISO date string — validated 18+ enforced
  gender: z.enum(["MALE", "FEMALE", "OTHER"]).optional(),
  nationality: z.string().default("Motswana"),
  omang: z.string().optional(),
  passportNumber: z.string().optional(),
  maritalStatus: z.enum(["SINGLE", "MARRIED", "DIVORCED", "WIDOWED", "SEPARATED"]).optional(),
  address: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().email().optional(),

  emergencyContactName: z.string().optional(),
  emergencyContactPhone: z.string().optional(),

  // Employment
  employmentType: EmploymentTypeEnum,
  jobTitle: z.string().optional(),
  startDate: z.string(), // ISO
  endDate: z.string().optional(),
  probationMonths: z.number().int().min(0).max(6).default(3),
  managerId: z.string().optional(),

  // Compensation
  basicSalary: z.number().positive(),
  bankName: BankNameEnum.optional(),
  bankAccountNumber: z.string().optional(),
  bankAccountHolder: z.string().optional(),

  // Tax
  taxStatus: TaxStatusEnum.default("RESIDENT"),
  bursTpn: z.string().optional(),
  pensionMembershipNumber: z.string().optional(),
  pensionContributionRate: z.number().min(0).max(20).default(5),

  // Work permit
  workPermitNumber: z.string().optional(),
  workPermitExpiry: z.string().optional(),
});

const UpdateEmployeeSchema = CreateEmployeeSchema.partial();

// ---------------------------------------------------------------
// HELPERS
// ---------------------------------------------------------------

function validate18Plus(dob: string): void {
  const birthDate = new Date(dob);
  const today = new Date();
  const age = today.getFullYear() - birthDate.getFullYear();
  const monthDiff = today.getMonth() - birthDate.getMonth();
  const actualAge = monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())
    ? age - 1
    : age;

  if (actualAge < 18) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Employee must be at least 18 years old. Current age: ${actualAge}.`,
    });
  }
}

function computeWorkPermitAlerts(workPermitExpiry: string | null | undefined): {
  alertDays: number | null;
} {
  if (!workPermitExpiry) return { alertDays: null };
  const expiry = new Date(workPermitExpiry);
  const today = new Date();
  const daysUntilExpiry = Math.ceil((expiry.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

  if (daysUntilExpiry <= 7) return { alertDays: 7 };
  if (daysUntilExpiry <= 14) return { alertDays: 14 };
  if (daysUntilExpiry <= 30) return { alertDays: 30 };
  return { alertDays: null };
}

// ---------------------------------------------------------------
// ROUTER
// ---------------------------------------------------------------

export const employeeRouter = router({
  // ─── List all employees ──────────────────────────────────────
  list: orgProcedure
    .input(
      z.object({
        status: EmployeeStatusEnum.optional(),
        branchId: z.string().optional(),
        departmentId: z.string().optional(),
        search: z.string().optional(),
        cursor: z.string().optional(),
        limit: z.number().min(1).max(100).default(50),
      })
    )
    .query(async ({ ctx, input }) => {
      const where: Record<string, unknown> = { organizationId: ctx.auth.organizationId! };
      if (input.status) where.status = input.status;
      if (input.branchId) where.branchId = input.branchId;
      if (input.departmentId) where.departmentId = input.departmentId;
      if (input.search) {
        where.OR = [
          { firstName: { contains: input.search, mode: "insensitive" } },
          { lastName: { contains: input.search, mode: "insensitive" } },
          { employeeNumber: { contains: input.search, mode: "insensitive" } },
          { omang: { contains: input.search, mode: "insensitive" } },
        ];
      }

      const employees = await ctx.prisma.employee.findMany({
        where,
        include: {
          branch: { select: { id: true, name: true } },
          department: { select: { id: true, name: true } },
          manager: { select: { id: true, firstName: true, lastName: true } },
        },
        orderBy: { lastName: "asc" },
        take: input.limit + 1,
        cursor: input.cursor ? { id: input.cursor } : undefined,
      });

      const hasMore = employees.length > input.limit;
      const items = hasMore ? employees.slice(0, -1) : employees;
      const nextCursor = hasMore ? items[items.length - 1]?.id : undefined;

      return { items, nextCursor };
    }),

  // ─── Get single employee ──────────────────────────────────────
  get: orgProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const employee = await ctx.prisma.employee.findFirst({
        where: { id: input.id, organizationId: ctx.auth.organizationId! },
        include: {
          branch: { select: { id: true, name: true } },
          department: { select: { id: true, name: true } },
          manager: { select: { id: true, firstName: true, lastName: true } },
          payComponentAssignments: {
            where: { isActive: true },
            include: { payComponent: true },
          },
          leaveBalances: { include: { policy: true } },
          directReports: { select: { id: true, firstName: true, lastName: true, jobTitle: true } },
        },
      });

      if (!employee) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Employee not found." });
      }

      // Check minimum wage
      const minWageFlag = checkMinimumWage(Number(employee.basicSalary));

      // Compute alert flags
      const workPermitAlert = computeWorkPermitAlerts(
        employee.workPermitExpiry ? employee.workPermitExpiry.toISOString() : null
      );

      const probationEnd = employee.probationEndDate
        ? new Date(employee.probationEndDate)
        : null;

      return {
        ...employee,
        minWageFlag,
        workPermitAlertDays: workPermitAlert.alertDays,
        probationEndDate: probationEnd,
        // Mask Omang — show only last 4 chars
        omangMasked: employee.omang
          ? `XXXX-${employee.omang.slice(-4)}`
          : null,
      };
    }),

  // ─── Create employee ──────────────────────────────────────────
  create: requireAdminOrHR
    .input(CreateEmployeeSchema)
    .mutation(async ({ ctx, input }) => {
      const orgId = ctx.auth.organizationId!;

      // Validate 18+ DOB
      validate18Plus(input.dateOfBirth);

      // Check Omang uniqueness (across entire platform)
      if (input.omang) {
        const existingOmang = await ctx.prisma.employee.findUnique({
          where: { omang: input.omang },
        });
        if (existingOmang) {
          throw new TRPCError({
            code: "CONFLICT",
            message: `Omang ${input.omang} is already registered for another employee.`,
          });
        }
      }

      // Check employee number uniqueness within org
      const existingNum = await ctx.prisma.employee.findUnique({
        where: { organizationId_employeeNumber: { organizationId: orgId, employeeNumber: input.employeeNumber } },
      });
      if (existingNum) {
        throw new TRPCError({
          code: "CONFLICT",
          message: `Employee number ${input.employeeNumber} already exists in this organization.`,
        });
      }

      // Compute probation end date
      const startDate = new Date(input.startDate);
      const probationEndDate = new Date(
        startDate.getFullYear(),
        startDate.getMonth() + input.probationMonths,
        startDate.getDate()
      );

      const dob = new Date(input.dateOfBirth);

      const employee = await ctx.prisma.employee.create({
        data: {
          organizationId: orgId,
          branchId: input.branchId ?? null,
          departmentId: input.departmentId ?? null,
          employeeNumber: input.employeeNumber,
          firstName: input.firstName,
          lastName: input.lastName,
          fullName: `${input.firstName} ${input.lastName}`,
          dateOfBirth: dob,
          gender: input.gender,
          nationality: input.nationality,
          omang: input.omang ?? null,
          passportNumber: input.passportNumber ?? null,
          maritalStatus: input.maritalStatus,
          address: input.address ?? null,
          phone: input.phone ?? null,
          email: input.email ?? null,
          emergencyContactName: input.emergencyContactName ?? null,
          emergencyContactPhone: input.emergencyContactPhone ?? null,
          employmentType: input.employmentType,
          jobTitle: input.jobTitle ?? null,
          startDate,
          endDate: input.endDate ? new Date(input.endDate) : null,
          probationEndDate,
          managerId: input.managerId ?? null,
          basicSalary: input.basicSalary,
          bankName: input.bankName,
          bankAccountNumber: input.bankAccountNumber ?? null,
          bankAccountHolder: input.bankAccountHolder ?? null,
          taxStatus: input.taxStatus,
          bursTpn: input.bursTpn ?? null,
          pensionMembershipNumber: input.pensionMembershipNumber ?? null,
          pensionContributionRate: input.pensionContributionRate,
          workPermitNumber: input.workPermitNumber ?? null,
          workPermitExpiry: input.workPermitExpiry ? new Date(input.workPermitExpiry) : null,
          status: "ACTIVE",
        },
      });

      // Create audit log
      await ctx.prisma.auditLog.create({
        data: {
          organizationId: orgId,
          userId: ctx.auth.id,
          userEmail: ctx.auth.email,
          action: "EMPLOYEE_CREATED",
          entityType: "Employee",
          entityId: employee.id,
          changes: { firstName: input.firstName, lastName: input.lastName, basicSalary: input.basicSalary },
        },
      });

      // Create default leave balances for statutory leave policies
      const statutoryPolicies = await ctx.prisma.leavePolicy.findMany({
        where: { organizationId: orgId, isStatutory: true, isActive: true },
      });

      for (const policy of statutoryPolicies) {
        await ctx.prisma.leaveBalance.create({
          data: {
            employeeId: employee.id,
            policyId: policy.id,
            accrued: policy.daysPerYear,
            used: 0,
            carriedOver: 0,
            remaining: policy.daysPerYear,
          },
        });
      }

      return { employeeId: employee.id };
    }),

  // ─── Update employee ──────────────────────────────────────────
  update: requireAdminOrHR
    .input(z.object({ id: z.string(), data: UpdateEmployeeSchema }))
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.prisma.employee.findFirst({
        where: { id: input.id, organizationId: ctx.auth.organizationId! },
      });

      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Employee not found." });
      }

      // Validate 18+ if DOB changed
      if (input.data.dateOfBirth && input.data.dateOfBirth !== existing.dateOfBirth.toISOString()) {
        validate18Plus(input.data.dateOfBirth);
      }

      // Check Omang uniqueness if changed
      if (input.data.omang && input.data.omang !== existing.omang) {
        const conflict = await ctx.prisma.employee.findUnique({
          where: { omang: input.data.omang },
        });
        if (conflict && conflict.id !== input.id) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "Omang already registered to another employee.",
          });
        }
      }

      const updateData: Record<string, unknown> = {};
      if (input.data.firstName) updateData.firstName = input.data.firstName;
      if (input.data.lastName) updateData.lastName = input.data.lastName;
      if (input.data.firstName || input.data.lastName) {
        updateData.fullName = `${input.data.firstName ?? existing.firstName} ${input.data.lastName ?? existing.lastName}`;
      }
      if (input.data.dateOfBirth) updateData.dateOfBirth = new Date(input.data.dateOfBirth);
      if (input.data.gender) updateData.gender = input.data.gender;
      if (input.data.nationality) updateData.nationality = input.data.nationality;
      if (input.data.omang !== undefined) updateData.omang = input.data.omang;
      if (input.data.passportNumber !== undefined) updateData.passportNumber = input.data.passportNumber;
      if (input.data.maritalStatus) updateData.maritalStatus = input.data.maritalStatus;
      if (input.data.address !== undefined) updateData.address = input.data.address;
      if (input.data.phone !== undefined) updateData.phone = input.data.phone;
      if (input.data.email !== undefined) updateData.email = input.data.email;
      if (input.data.emergencyContactName !== undefined) updateData.emergencyContactName = input.data.emergencyContactName;
      if (input.data.emergencyContactPhone !== undefined) updateData.emergencyContactPhone = input.data.emergencyContactPhone;
      if (input.data.employmentType) updateData.employmentType = input.data.employmentType;
      if (input.data.jobTitle !== undefined) updateData.jobTitle = input.data.jobTitle;
      if (input.data.startDate) updateData.startDate = new Date(input.data.startDate);
      if (input.data.endDate !== undefined) {
        updateData.endDate = input.data.endDate ? new Date(input.data.endDate) : null;
      }
      if (input.data.probationMonths !== undefined && input.data.startDate) {
        const start = input.data.startDate ? new Date(input.data.startDate) : existing.startDate;
        updateData.probationEndDate = new Date(start.getFullYear(), start.getMonth() + input.data.probationMonths, start.getDate());
      }
      if (input.data.managerId !== undefined) updateData.managerId = input.data.managerId;
      if (input.data.basicSalary !== undefined) updateData.basicSalary = input.data.basicSalary;
      if (input.data.bankName !== undefined) updateData.bankName = input.data.bankName;
      if (input.data.bankAccountNumber !== undefined) updateData.bankAccountNumber = input.data.bankAccountNumber;
      if (input.data.bankAccountHolder !== undefined) updateData.bankAccountHolder = input.data.bankAccountHolder;
      if (input.data.taxStatus) updateData.taxStatus = input.data.taxStatus;
      if (input.data.bursTpn !== undefined) updateData.bursTpn = input.data.bursTpn;
      if (input.data.pensionMembershipNumber !== undefined) updateData.pensionMembershipNumber = input.data.pensionMembershipNumber;
      if (input.data.pensionContributionRate !== undefined) updateData.pensionContributionRate = input.data.pensionContributionRate;
      if (input.data.workPermitNumber !== undefined) updateData.workPermitNumber = input.data.workPermitNumber;
      if (input.data.workPermitExpiry !== undefined) {
        updateData.workPermitExpiry = input.data.workPermitExpiry ? new Date(input.data.workPermitExpiry) : null;
      }

      const updated = await ctx.prisma.employee.update({
        where: { id: input.id },
        data: updateData,
      });

      await ctx.prisma.auditLog.create({
        data: {
          organizationId: ctx.auth.organizationId!,
          userId: ctx.auth.id,
          userEmail: ctx.auth.email,
          action: "EMPLOYEE_UPDATED",
          entityType: "Employee",
          entityId: input.id,
          changes: { before: existing, after: updateData },
        },
      });

      return { updated: true };
    }),

  // ─── Terminate employee ───────────────────────────────────────
  terminate: requireAdminOrHR
    .input(
      z.object({
        id: z.string(),
        terminationDate: z.string(),
        reason: z.string().min(1),
        terminationType: z.enum(["RESIGNED", "DISMISSED", "REDUNDANCY", "END_OF_CONTRACT"]),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const employee = await ctx.prisma.employee.findFirst({
        where: { id: input.id, organizationId: ctx.auth.organizationId! },
      });

      if (!employee) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Employee not found." });
      }

      if (employee.status === "TERMINATED" || employee.status === "RESIGNED") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Employee already has status: ${employee.status}`,
        });
      }

      // Calculate years of service for severance
      const startDate = new Date(employee.startDate);
      const terminationDate = new Date(input.terminationDate);
      const monthsOfService = Math.max(
        0,
        (terminationDate.getFullYear() - startDate.getFullYear()) * 12 +
        (terminationDate.getMonth() - startDate.getMonth())
      );
      const yearsOfService = monthsOfService / 12;

      await ctx.prisma.employee.update({
        where: { id: input.id },
        data: {
          status: input.terminationType === "RESIGNED" ? "RESIGNED" : "TERMINATED",
          endDate: terminationDate,
        },
      });

      await ctx.prisma.auditLog.create({
        data: {
          organizationId: ctx.auth.organizationId!,
          userId: ctx.auth.id,
          userEmail: ctx.auth.email,
          action: "EMPLOYEE_TERMINATED",
          entityType: "Employee",
          entityId: input.id,
          changes: {
            reason: input.reason,
            terminationType: input.terminationType,
            terminationDate: input.terminationDate,
            yearsOfService: Math.round(yearsOfService * 10) / 10,
            monthsOfService,
          },
        },
      });

      return {
        terminated: true,
        terminationDate: input.terminationDate,
        yearsOfService: Math.round(yearsOfService * 10) / 10,
        monthsOfService,
      };
    }),

  // ─── Get employee count (for plan enforcement) ─────────────────
  getCount: orgProcedure.query(async ({ ctx }) => {
    const count = await ctx.prisma.employee.count({
      where: {
        organizationId: ctx.auth.organizationId!,
        status: { in: ["ACTIVE", "ON_LEAVE", "SUSPENDED"] },
      },
    });
    return { count };
  }),
});
