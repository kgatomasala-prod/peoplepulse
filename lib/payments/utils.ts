import { SUBSCRIPTION_PLANS } from './plans';
import { prisma } from '@/lib/prisma';

export const checkPlanLimits = async (organizationId: string) => {
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    include: { _count: { select: { employees: true } } }
  });

  if (!org) throw new Error('Organization not found');

  const planKey = org.plan.toUpperCase() as keyof typeof SUBSCRIPTION_PLANS;
  const plan = SUBSCRIPTION_PLANS[planKey];

  if (!plan) throw new Error('Invalid plan');

  const employeeCount = org._count.employees;

  return {
    employeeCount,
    limit: plan.maxEmployees,
    isOverLimit: employeeCount > plan.maxEmployees,
  };
};

export const handleFailedPayment = async (organizationId: string, gracePeriodExpired: boolean) => {
  // 3-day grace -> read-only mode -> 14-day suspension
  // This would be triggered by a webhook or scheduled job
  
  if (gracePeriodExpired) {
    // Set to read-only or suspended
    await prisma.organization.update({
      where: { id: organizationId },
      data: { plan: 'Suspended' } // Or use a separate status field
    });
  }
};

export const startTrial = (organizationId: string) => {
  const trialEndsAt = new Date();
  trialEndsAt.setDate(trialEndsAt.getDate() + 30);
  
  return prisma.organization.update({
    where: { id: organizationId },
    data: { trialEndsAt }
  });
};
