import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { headers } from "next/headers";

export async function POST(req: Request) {
  const body = await req.text();
  const headersList = await headers();
  const sig = headersList.get("clerk-signature") ?? "";

  // TODO: verify webhook signature with svix in production
  const event = JSON.parse(body) as { type: string; data: Record<string, unknown> };

  switch (event.type) {
    case "organization.created": {
      const { id: clerkOrgId, name } = event.data as { id: string; name: string };
      const existing = await prisma.organization.findUnique({ where: { clerkOrgId } });
      if (existing) return NextResponse.json({ ok: true });

      const trialEndsAt = new Date();
      trialEndsAt.setDate(trialEndsAt.getDate() + 30);

      const org = await prisma.organization.create({
        data: { clerkOrgId, name, plan: "TRIAL", trialEndsAt },
      });

      // Seed statutory leave policies
      const statutoryPolicies = [
        { type: "ANNUAL", daysPerYear: 15, isStatutory: true },
        { type: "SICK", daysPerYear: 14, isStatutory: true },
        { type: "MATERNITY", daysPerYear: 98, isStatutory: true },
        { type: "PATERNITY", daysPerYear: 3, isStatutory: true },
      ];
      for (const p of statutoryPolicies) {
        await prisma.leavePolicy.upsert({
          where: { organizationId_type: { organizationId: org.id, type: p.type } },
          create: { organizationId: org.id, ...p },
          update: { isStatutory: true },
        });
      }
      return NextResponse.json({ ok: true, orgCreated: true });
    }
    case "organization.updated": {
      const { id: clerkOrgId, name } = event.data as { id: string; name: string };
      await prisma.organization.updateMany({ where: { clerkOrgId }, data: { name } });
      return NextResponse.json({ ok: true });
    }
    default:
      return NextResponse.json({ ok: true });
  }
}