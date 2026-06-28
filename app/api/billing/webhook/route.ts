import { NextRequest, NextResponse } from "next/server";
import { getPlanForStripePrice } from "@/lib/billing";
import { getWorkspaceRepository } from "@/lib/server/repository";
import {
  constructStripeWebhookEvent,
  type StripeEventObject,
} from "@/lib/server/stripe";
import type { BillingPlan } from "@/lib/types";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const payload = await request.text();
  let event;

  try {
    event = constructStripeWebhookEvent(
      payload,
      request.headers.get("stripe-signature"),
    );
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Invalid Stripe webhook.",
      },
      { status: 400 },
    );
  }

  const repository = getWorkspaceRepository();
  const object = event.data.object;

  if (event.type === "checkout.session.completed") {
    const businessId = object.metadata?.businessId;
    const planId = parsePlanId(object.metadata?.planId);
    const customerId = stringValue(object.customer);

    if (businessId && planId && customerId) {
      await repository.updateStripeBilling({
        businessId,
        customerId,
        planId,
        status: object.status ?? "active",
        subscriptionId: stringValue(object.subscription),
      });
    }
  }

  if (
    event.type === "customer.subscription.updated" ||
    event.type === "customer.subscription.deleted"
  ) {
    const customerId = stringValue(object.customer);
    const plan = getPlanForStripePrice(firstSubscriptionPriceId(object));

    if (customerId && plan) {
      await repository.updateStripeBillingByCustomer({
        customerId,
        planId: plan.id,
        status: object.status ?? "unknown",
        subscriptionId: stringValue(object.id),
      });
    }
  }

  return NextResponse.json({ received: true });
}

function parsePlanId(value: string | undefined): BillingPlan["id"] | null {
  if (value === "starter" || value === "growth" || value === "pro") {
    return value;
  }

  return null;
}

function firstSubscriptionPriceId(object: StripeEventObject) {
  return object.items?.data?.[0]?.price?.id;
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : null;
}
