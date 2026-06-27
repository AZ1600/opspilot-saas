import type { BillingPlan } from "@/lib/types";

export const billingPlans: BillingPlan[] = [
  {
    id: "starter",
    name: "Starter",
    priceMonthly: 99,
    actionLimit: 100,
    inboxScanLimit: 250,
  },
  {
    id: "growth",
    name: "Growth",
    priceMonthly: 249,
    actionLimit: 500,
    inboxScanLimit: 1500,
  },
  {
    id: "pro",
    name: "Pro",
    priceMonthly: 599,
    actionLimit: 2000,
    inboxScanLimit: 7500,
  },
];

export function getPlan(planId: BillingPlan["id"]) {
  return billingPlans.find((plan) => plan.id === planId) ?? billingPlans[0];
}
