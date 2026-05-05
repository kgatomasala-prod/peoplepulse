// ============================================================
// PeoplePulse — Super Admin tRPC Router
// Platform operations: tenants, MRR, tax table editor, feature flags
// ============================================================

import { z } from "zod";
import { router, superAdminProcedure, requireAdminOrHR } from "../trpc";
import { TRPCError } from "@trpc/server";

export const superAdminRouter = router({
  // ─── List all tenants ──────────────────────────────────────────
  listTenants: superAdminProcedure
    .input(
      z.object({
        plan: z.enum(["TRIAL", "STARTER", "GROWTH", "BUSINESS", "ENTERPRISE"]).optional(),
        search: z.string().optional(),
        limit: z.number().min(1).max(100).default(50),
        cursor: z.string().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const where: Record<string, unknown> = {};
      if (input.plan) where.plan = input.plan;
      if (input.search) {
        where.OR = [
          { name: { contains: input.search, mode: "insensitive" } },
          { bursTin: { contains: input.search, mode: "insensitive" } },
        ];
      }

      const tenants = await ctx.prisma.organization.findMany({
        where,
        include: {
          subscriptions: {
            where: { status: "ACTIVE" },
            take: 1,
            orderBy: { createdAt: "desc" },
          },
          _count: { select: { employees: true } },
        },
        orderBy: { createdAt: "desc" },
        take: input.limit + 1,
        cursor: input.cursor ? { id: input.cursor } : undefined,
      });

      let nextCursor: string | undefined;
      if (tenants.length > input.limit) {
        nextCursor = tenants.pop()!.id;
      }

      return { tenants, nextCursor };
    }),

  // ─── MRR Dashboard ─────────────────────────────────────────────
  getMRR: superAdminProcedure.query(async ({ ctx }) => {
    const tenants = await ctx.prisma.organization.findMany({
      where: { active: true },
      include: {
        subscriptions: {
          where: { status: "ACTIVE" },
          select: {
            plan: true,
            amountBwp: true,
            billingCycle: true,
          },
        },
      },
    });

    const planPrices: Record<string, number> = {
      STARTER: 299,
      GROWTH: 799,
      BUSINESS: 1999,
      // ENTERPRISE is custom — not counted in MRR
    };

    let mrr = 0;
    let activeCount = 0;
    let trialCount = 0;
    let starterCount = 0;
    let growthCount = 0;
    let businessCount = 0;
    let enterpriseCount = 0;

    const byPlan: Record<string, number> = {};

    for (const tenant of tenants) {
      if (tenant.plan === "TRIAL") {
        trialCount++;
        continue;
      }

      const sub = tenant.subscriptions[0];
      if (!sub) continue;

      activeCount++;

      if (tenant.plan === "ENTERPRISE") {
        enterpriseCount++;
        continue;
      }

      const monthlyAmount = sub.billingCycle === "ANNUAL"
        ? (planPrices[tenant.plan] ?? 0) * 12 / 12  // annual already monthly-equivalent
        : (planPrices[tenant.plan] ?? 0);

      mrr += monthlyAmount;
      byPlan[tenant.plan] = (byPlan[tenant.plan] ?? 0) + monthlyAmount;

      if (tenant.plan === "STARTER") starterCount++;
      if (tenant.plan === "GROWTH") growthCount++;
      if (tenant.plan === "BUSINESS") businessCount++;
    }

    // Count churned in last 30 days
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const churned = await ctx.prisma.subscription.count({
      where: {
        status: "CANCELLED",
        cancelledAt: { gte: thirtyDaysAgo },
      },
    });

    return {
      mrr,
      mrrFormatted: `P${mrr.toLocaleString("en-US", { minimumFractionDigits: 2 })}`,
      activeCount,
      trialCount,
      byPlan: {
        starter: starterCount,
        growth: growthCount,
        business: businessCount,
        enterprise: enterpriseCount,
      },
      churnedLast30Days: churned,
    };
  }),

  // ─── Tax band editor (update without code deploy) ──────────────
  updateTaxBand: superAdminProcedure
    .input(
      z.object({
        bandId: z.string(),
        ratePercent: z.number().min(0).max(100),
        bandMax: z.number().positive().nullable().optional(),
        cumulativeTaxBelow: z.number().min(0).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const band = await ctx.prisma.taxBand.findUnique({ where: { id: input.bandId } });
      if (!band) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Tax band not found." });
      }

      return ctx.prisma.taxBand.update({
        where: { id: input.bandId },
        data: {
          ratePercent: input.ratePercent,
          bandMax: input.bandMax,
          cumulativeTaxBelow: input.cumulativeTaxBelow ?? band.cumulativeTaxBelow,
        },
      });
    }),

  // ─── Add new tax band ──────────────────────────────────────────
  addTaxBand: superAdminProcedure
    .input(
      z.object({
        countryId: z.string(),
        taxYear: z.number().int().min(2024),
        residentStatus: z.enum(["RESIDENT", "NON_RESIDENT"]),
        bandMin: z.number().min(0),
        bandMax: z.number().positive().nullable(),
        ratePercent: z.number().min(0).max(100),
        cumulativeTaxBelow: z.number().min(0).default(0),
      })
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.prisma.taxBand.create({ data: input });
    }),

  // ─── Get all tax bands for a country/year ──────────────────────
  getTaxBands: superAdminProcedure
    .input(
      z.object({
        countryCode: z.string().default("BW"),
        taxYear: z.number().int().min(2024),
      })
    )
    .query(async ({ ctx, input }) => {
      return ctx.prisma.taxBand.findMany({
        where: {
          country: { code: input.countryCode },
          taxYear: input.taxYear,
        },
        include: { country: true },
        orderBy: [{ residentStatus: "asc" }, { bandMin: "asc" }],
      });
    }),

  // ─── Public holiday manager ────────────────────────────────────
  listHolidays: superAdminProcedure
    .input(z.object({ countryCode: z.string().default("BW"), year: z.number().int().min(2024) }))
    .query(async ({ ctx, input }) => {
      const start = new Date(input.year, 0, 1);
      const end = new Date(input.year, 11, 31);

      return ctx.prisma.publicHoliday.findMany({
        where: {
          countryCode: input.countryCode,
          date: { gte: start, lte: end },
        },
        orderBy: { date: "asc" },
      });
    }),

  addHoliday: superAdminProcedure
    .input(
      z.object({
        countryCode: z.string().default("BW"),
        name: z.string().min(1),
        date: z.string(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.prisma.publicHoliday.create({
        data: {
          countryCode: input.countryCode,
          name: input.name,
          date: new Date(input.date),
          applicableRegions: [],
        },
      });
    }),

  // ─── Feature flag control per tenant ────────────────────────────
  setFeatureFlag: superAdminProcedure
    .input(
      z.object({
        organizationId: z.string(),
        feature: z.string(),
        enabled: z.boolean(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.prisma.featureFlag.upsert({
        where: {
          organizationId_feature: {
            organizationId: input.organizationId,
            feature: input.feature,
          },
        },
        create: {
          organizationId: input.organizationId,
          feature: input.feature,
          enabled: input.enabled,
        },
        update: { enabled: input.enabled },
      });
    }),

  // ─── Cross-tenant audit log viewer ─────────────────────────────
  getAuditLog: superAdminProcedure
    .input(
      z.object({
        organizationId: z.string().optional(),
        userId: z.string().optional(),
        action: z.string().optional(),
        from: z.string().optional(),
        to: z.string().optional(),
        limit: z.number().min(1).max(100).default(50),
        cursor: z.string().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const where: Record<string, unknown> = {};
      if (input.organizationId) where.organizationId = input.organizationId;
      if (input.userId) where.userId = input.userId;
      if (input.action) where.action = input.action;
      if (input.from || input.to) {
        where.createdAt = {};
        if (input.from) (where.createdAt as Record<string, unknown>).gte = new Date(input.from);
        if (input.to) (where.createdAt as Record<string, unknown>).lte = new Date(input.to);
      }

      const logs = await ctx.prisma.auditLog.findMany({
        where,
        include: { organization: { select: { name: true } } },
        orderBy: { createdAt: "desc" },
        take: input.limit + 1,
        cursor: input.cursor ? { id: input.cursor } : undefined,
      });

      let nextCursor: string | undefined;
      if (logs.length > input.limit) {
        nextCursor = logs.pop()!.id;
      }

      return { logs, nextCursor };
    }),

  // ─── Coupon management ─────────────────────────────────────────
  createCoupon: superAdminProcedure
    .input(
      z.object({
        code: z.string().min(3).max(20),
        discountType: z.enum(["PERCENTAGE", "FIXED_AMOUNT"]),
        discountValue: z.number().positive(),
        maxUses: z.number().int().positive().optional(),
        validFrom: z.string(),
        validTo: z.string(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.prisma.coupon.create({
        data: {
          ...input,
          validFrom: new Date(input.validFrom),
          validTo: new Date(input.validTo),
        },
      });
    }),

  // ─── Toggle org active status ──────────────────────────────────
  toggleOrgActive: superAdminProcedure
    .input(z.object({ organizationId: z.string(), active: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      return ctx.prisma.organization.update({
        where: { id: input.organizationId },
        data: { active: input.active },
      });
    }),
});
