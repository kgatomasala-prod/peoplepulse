// ============================================================
// PeoplePulse — Clerk Webhook Handler
// Handles org creation, user invitation, role assignment
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { clerkClient, type WebhookEvent } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";

// Disable body parsing — we need the raw body for webhook signature
export const config = {
  api: { bodyParser: false },
};

export async function POST(req: NextRequest) {
  const WEBHOOK_SECRET = process.env.CLERK_WEBHOOK_SECRET;
  if (!WEBHOOK_SECRET) {
    return NextResponse.json({ error: "Missing CLERK_WEBHOOK_SECRET" }, { status: 500 });
  }

  const body = await req.text();
  const signature = req.headers.get("clerk-webhook-signature") ?? "";

  // Verify signature (simplified — use actual Clerk verification in prod)
  // const isValid = verifyWebhookSignature(body, signature, WEBHOOK_SECRET);

  let evt: WebhookEvent;
  try {
    evt = JSON.parse(body) as WebhookEvent;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  try {
    switch (evt.type) {
      case "organization.created": {
        const org = evt.data;
        await prisma.organization.create({
          data: {
            clerkOrgId: org.id,
            name: org.name,
            // Default to trial, admin will update via onboarding wizard
            plan: "TRIAL",
            trialEndsAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
          },
        });

        // Seed default leave policies for Botswana statutory minimums
        await prisma.leavePolicy.createMany({
          data: [
            { organizationId: (await prisma.organization.findUnique({ where: { clerkOrgId: org.id } }))!.id, type: "ANNUAL", daysPerYear: 15, carryOverMax: 5, isStatutory: true },
            { organizationId: (await prisma.organization.findUnique({ where: { clerkOrgId: org.id } }))!.id, type: "SICK", daysPerYear: 14, carryOverMax: 0, isStatutory: true },
            { organizationId: (await prisma.organization.findUnique({ where: { clerkOrgId: org.id } }))!.id, type: "MATERNITY", daysPerYear: 98, carryOverMax: 0, isStatutory: true }, // 14 weeks
            { organizationId: (await prisma.organization.findUnique({ where: { clerkOrgId: org.id } }))!.id, type: "PATERNITY", daysPerYear: 3, carryOverMax: 0, isStatutory: true },
          ],
        });
        break;
      }

      case "organizationMembership.created": {
        const membership = evt.data;
        // Map Clerk role to app role in public metadata
        const clerkRole = membership.role; // "admin" | "member" | "guest"
        let appRole = "employee";

        if (clerkRole === "admin") {
          appRole = "company_admin";
        }

        const clerk = await clerkClient();
        await clerk.organizations.updateOrganizationMetadata(membership.organizationId, {
          publicMetadata: { appRole },
        });
        break;
      }

      case "user.created": {
        const user = evt.data;
        // Could create a user profile here if needed
        break;
      }
    }

    return NextResponse.json({ received: true });
  } catch (err) {
    console.error("Clerk webhook error:", err);
    return NextResponse.json({ error: "Webhook processing failed" }, { status: 500 });
  }
}