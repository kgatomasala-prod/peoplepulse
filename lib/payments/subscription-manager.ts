import { SUBSCRIPTION_PLANS } from './plans';
import { prisma } from '@/lib/prisma';
import { sendEmail } from '@/lib/email';
import { sendSMS } from '@/lib/sms';

export class SubscriptionManager {
  /**
   * Checks if an organization is within its plan limits.
   * If over limit, returns a prompt for upgrade.
   */
  static async checkPlanOverage(organizationId: string) {
    const org = await prisma.organization.findUnique({
      where: { id: organizationId },
      include: { _count: { select: { employees: true } } },
    });

    if (!org) throw new Error('Organization not found');

    const currentPlan = SUBSCRIPTION_PLANS[org.plan.toUpperCase() as keyof typeof SUBSCRIPTION_PLANS];
    const employeeCount = org._count.employees;

    if (employeeCount > currentPlan.maxEmployees) {
      return {
        isOverLimit: true,
        employeeCount,
        limit: currentPlan.maxEmployees,
        message: `Your current ${org.plan} plan is limited to ${currentPlan.maxEmployees} employees. You currently have ${employeeCount}. Please upgrade to the next tier.`,
      };
    }

    return { isOverLimit: false, employeeCount, limit: currentPlan.maxEmployees };
  }

  /**
   * Handles the failed payment workflow:
   * 3-day grace -> read-only -> 14-day suspension -> data export
   */
  static async handlePaymentFailure(organizationId: string, retryCount: number) {
    const org = await prisma.organization.findUnique({ where: { id: organizationId } });
    if (!org) return;

    if (retryCount === 1) {
      // Day 1: Notify and 3-day grace starts
      await sendEmail({
        to: 'admin@' + org.name.toLowerCase().replace(/ /g, '') + '.bw',
        subject: 'PeoplePulse Payment Failed - 3 Day Grace Period',
        html: `<p>Payment for ${org.name} failed. You have a 3-day grace period to update your billing details before the system enters read-only mode.</p>`,
      });
    } else if (retryCount === 3) {
      // Day 3: Read-only mode
      await prisma.organization.update({
        where: { id: organizationId },
        data: { subscriptionStatus: 'PastDue_ReadOnly' },
      });
      await sendSMS({
        to: '+26771234567', // Company Admin Phone
        message: `PeoplePulse: ${org.name} is now in Read-Only mode due to failed payment. Update billing to restore access.`,
      });
    } else if (retryCount === 14) {
      // Day 14: Suspension
      await prisma.organization.update({
        where: { id: organizationId },
        data: { subscriptionStatus: 'Suspended' },
      });
      // Data export trigger logic would go here
    }
  }

  /**
   * Updates an organization's plan tier.
   */
  static async upgradePlan(organizationId: string, newPlan: keyof typeof SUBSCRIPTION_PLANS) {
    const plan = SUBSCRIPTION_PLANS[newPlan];
    return await prisma.organization.update({
      where: { id: organizationId },
      data: {
        plan: plan.name,
        subscriptionStatus: 'Active',
      },
    });
  }
}
