import type { BillingPlan } from "@/lib/types";

export const billingPlans: BillingPlan[] = [
  {
    id: "starter",
    name: "Starter",
    priceMonthly: 29,
    actionLimit: 100,
    inboxScanLimit: 250,
  },
  {
    id: "growth",
    name: "Growth",
    priceMonthly: 79,
    actionLimit: 500,
    inboxScanLimit: 1500,
  },
  {
    id: "pro",
    name: "Pro",
    priceMonthly: 199,
    actionLimit: 2000,
    inboxScanLimit: 7500,
  },
];

export function getPlan(planId: BillingPlan["id"]) {
  return billingPlans.find((plan) => plan.id === planId) ?? billingPlans[0];
}

export function getPlanForStripePrice(priceId: string | null | undefined) {
  if (!priceId) {
    return null;
  }

  return (
    billingPlans.find(
      (plan) => process.env[stripePriceEnvName(plan.id)] === priceId,
    ) ?? null
  );
}

export function getStripePriceId(planId: BillingPlan["id"]) {
  return process.env[stripePriceEnvName(planId)];
}

export function stripePriceEnvName(planId: BillingPlan["id"]) {
  return `STRIPE_PRICE_${planId.toUpperCase()}`;
}
