// ============================================================
// PeoplePulse — Disciplinary & Performance tRPC Router
// Case flow: incident → hearing → sanction → acknowledgement
// Performance reviews: KPI templates, sign-off workflow
// ============================================================

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import {
  router,
  orgProcedure,
  requireAdminOrHR,
  requireRole,
} from "../trpc";

const DisciplinaryStatusEnum = z.enum(["OPEN", "HEARING_SCHEDULED", "HEARING_HELD", "CLOSED"]);
const SanctionTypeEnum = z.enum([
  "VERBAL_WARNING", "FIRST_WRITTEN_WARNING", "FINAL_WRITTEN_WARNING",
  "SUSPENSION", "DEMOTION", "DISMISSAL",
]);

export const disciplinaryRouter = router({
  // ─── Log new disciplinary case ────────────────────────────────
  createCase: requireAdminOrHR
    .input(
      z.object({
        employeeId: z.string(),
        incidentDate: z.string(),
        incidentDescription: z.string().min(10),
        witnessNames: z.string().optional(),
        evidenceUrls: z.array(z.string()).optional(),
        caseType: z.enum(["MISCONDUCT", "POOR_PERFORMANCE", "DISCIPLINARY", "GRIEVANCE"]),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const employee = await ctx.prisma.employee.findUniqueOrThrow({
        where: { id: input.employeeId, organizationId: ctx.auth.organizationId! },
      });

      const caseData = await ctx.prisma.disciplinaryCase.create({
        data: {
          organizationId: ctx.auth.organizationId!,
          employeeId: input.employeeId,
          incidentDate: new Date(input.incidentDate),
          incidentDescription: input.incidentDescription,
          witnessNames: input.witnessNames,
          evidenceUrls: input.evidenceUrls ?? [],
          caseType: input.caseType,
          status: "OPEN",
        },
      });

      await ctx.prisma.auditLog.create({
        data: {
          organizationId: ctx.auth.organizationId!,
          userId: ctx.auth.id,
          userEmail: ctx.auth.email,
          action: "CASE_CREATED",
          entityType: "DisciplinaryCase",
          entityId: caseData.id,
          changes: {
            employeeId: input.employeeId,
            employeeName: employee.fullName,
            caseType: input.caseType,
          },
        },
      });

      return caseData;
    }),

  // ─── Schedule disciplinary hearing ─────────────────────────────
  scheduleHearing: requireAdminOrHR
    .input(
      z.object({
        caseId: z.string(),
        hearingDate: z.string(),
        hearingVenue: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const caseData = await ctx.prisma.disciplinaryCase.findFirstOrThrow({
        where: { id: input.caseId, organizationId: ctx.auth.organizationId! },
      });

      if (caseData.status === "CLOSED") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Case is already closed." });
      }

      return ctx.prisma.disciplinaryCase.update({
        where: { id: input.caseId },
        data: {
          status: "HEARING_SCHEDULED",
          hearingDate: new Date(input.hearingDate),
          hearingVenue: input.hearingVenue,
          hearingInviteSentAt: new Date(),
        },
      });
    }),

  // ─── Record hearing outcome + issue sanction ─────────────────
  recordOutcome: requireAdminOrHR
    .input(
      z.object({
        caseId: z.string(),
        hearingOutcome: z.string(),
        sanction: SanctionTypeEnum,
        employeeResponse: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const caseData = await ctx.prisma.disciplinaryCase.findFirstOrThrow({
        where: { id: input.caseId, organizationId: ctx.auth.organizationId! },
      });

      return ctx.prisma.disciplinaryCase.update({
        where: { id: input.caseId },
        data: {
          status: "CLOSED",
          hearingOutcome: input.hearingOutcome,
          sanction: input.sanction,
          employeeResponse: input.employeeResponse,
          sanctionLetterSentAt: new Date(),
        },
      });
    }),

  // ─── Employee acknowledges sanction ────────────────────────────
  acknowledgeSanction: orgProcedure
    .input(z.object({ caseId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const caseData = await ctx.prisma.disciplinaryCase.findFirstOrThrow({
        where: {
          id: input.caseId,
          employee: { organizationId: ctx.auth.organizationId! },
        },
      });

      if (!caseData.sanction) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "No sanction has been issued yet." });
      }

      if (caseData.acknowledgedAt) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Sanction already acknowledged." });
      }

      return ctx.prisma.disciplinaryCase.update({
        where: { id: input.caseId },
        data: { acknowledgedAt: new Date() },
      });
    }),

  // ─── List cases for org ──────────────────────────────────────
  listCases: orgProcedure
    .input(
      z.object({
        employeeId: z.string().optional(),
        status: DisciplinaryStatusEnum.optional(),
        caseType: z.enum(["MISCONDUCT", "POOR_PERFORMANCE", "DISCIPLINARY", "GRIEVANCE"]).optional(),
        limit: z.number().min(1).max(100).default(50),
      })
    )
    .query(async ({ ctx, input }) => {
      const where: Record<string, unknown> = { organizationId: ctx.auth.organizationId! };
      if (input.employeeId) where.employeeId = input.employeeId;
      if (input.status) where.status = input.status;
      if (input.caseType) where.caseType = input.caseType;

      return ctx.prisma.disciplinaryCase.findMany({
        where,
        include: {
          employee: { select: { id: true, firstName: true, lastName: true, jobTitle: true } },
        },
        orderBy: { createdAt: "desc" },
        take: input.limit,
      });
    }),

  // ─── PERFORMANCE REVIEWS ──────────────────────────────────────

  // Create review template / start review
  createReview: requireRole("company_admin", "hr_manager", "payroll_officer", "line_manager")
    .input(
      z.object({
        employeeId: z.string(),
        reviewPeriod: z.string(),
        reviewDate: z.string(),
        managerId: z.string(),
        kpis: z.array(
          z.object({
            name: z.string(),
            target: z.string(),
            actual: z.string().optional(),
            rating: z.number().int().min(1).max(5).optional(),
            comments: z.string().optional(),
          })
        ),
      })
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.prisma.performanceReview.create({
        data: {
          employeeId: input.employeeId,
          reviewPeriod: input.reviewPeriod,
          reviewDate: new Date(input.reviewDate),
          managerId: input.managerId,
          status: "DRAFT",
          kpis: input.kpis,
        },
      });
    }),

  // Manager submits review
  submitReview: requireRole("company_admin", "hr_manager", "payroll_officer", "line_manager")
    .input(
      z.object({
        reviewId: z.string(),
        overallRating: z.number().int().min(1).max(5),
        managerComments: z.string(),
        salaryReviewNotes: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const review = await ctx.prisma.performanceReview.findFirstOrThrow({
        where: { id: input.reviewId },
      });

      if (review.managerSignedAt) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Review already submitted." });
      }

      return ctx.prisma.performanceReview.update({
        where: { id: input.reviewId },
        data: {
          status: "MANAGER_REVIEW",
          overallRating: input.overallRating,
          managerComments: input.managerComments,
          salaryReviewNotes: input.salaryReviewNotes,
          managerSignedAt: new Date(),
        },
      });
    }),

  // Employee acknowledges review
  acknowledgeReview: orgProcedure
    .input(
      z.object({
        reviewId: z.string(),
        employeeComments: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const review = await ctx.prisma.performanceReview.findFirstOrThrow({
        where: { id: input.reviewId },
      });

      return ctx.prisma.performanceReview.update({
        where: { id: input.reviewId },
        data: {
          status: "SIGNED_OFF",
          employeeComments: input.employeeComments,
          employeeSignedAt: new Date(),
        },
      });
    }),

  // Get reviews for employee
  getEmployeeReviews: orgProcedure
    .input(z.object({ employeeId: z.string() }))
    .query(async ({ ctx, input }) => {
      return ctx.prisma.performanceReview.findMany({
        where: { employeeId: input.employeeId },
        orderBy: { reviewDate: "desc" },
      });
    }),
});
