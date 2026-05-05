export const SUBSCRIPTION_PLANS = {
  STARTER: {
    id: 'starter',
    name: 'Starter',
    price: 299, // BWP
    maxEmployees: 10,
    features: ['Standard Payroll', 'Leave Management', 'BURS ITW-7 Generation'],
  },
  GROWTH: {
    id: 'growth',
    name: 'Growth',
    price: 799, // BWP
    maxEmployees: 50,
    features: ['Everything in Starter', 'AI HR Assistant', 'Multi-Branch Support'],
  },
  BUSINESS: {
    id: 'business',
    name: 'Business',
    price: 1999, // BWP
    maxEmployees: 200,
    features: ['Everything in Growth', 'Custom Reports', 'API Access'],
  },
  ENTERPRISE: {
    id: 'enterprise',
    name: 'Enterprise',
    price: null, // Custom
    maxEmployees: Infinity,
    features: ['Unlimited Employees', 'Dedicated Support', 'SSO'],
  },
};

export const TRIAL_DAYS = 30;
export const ANNUAL_DISCOUNT_MONTHS = 2; // 2 months free for annual billing
