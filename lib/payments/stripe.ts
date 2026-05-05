import Stripe from 'stripe';

const stripeSecretKey = process.env.STRIPE_SECRET_KEY;

export const stripe = new Stripe(stripeSecretKey || '', {
  apiVersion: '2024-04-10',
});

/**
 * Creates a Stripe checkout session for expansion markets (ZAR/USD).
 */
export const createCheckoutSession = async (params: Stripe.Checkout.SessionCreateParams) => {
  return await stripe.checkout.sessions.create(params);
};

export const createCustomerPortalSession = async (params: Stripe.BillingPortal.SessionCreateParams) => {
  return await stripe.billingPortal.sessions.create(params);
};
