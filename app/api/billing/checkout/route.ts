import { NextRequest, NextResponse } from "next/server";
import { billingPlans, getStripePriceId } from "@/lib/billing";
import { presentWorkspace, requireSession } from "@/lib/server/auth";
import { forbidden, hasPermission } from "@/lib/server/permissions";
import { getWorkspaceRepository } from "@/lib/server/repository";
import { createCheckoutSession, isStripeConfigured } from "@/lib/server/stripe";
import type { BillingPlan } from "@/lib/types";

export const runtime = "nodejs";

const planIds = new Set(billingPlans.map((plan) => plan.id));

export async function POST(request: NextRequest) {
  const body = (await request.json()) as { planId?: BillingPlan["id"] };
  const session = await requireSession();

  if (!hasPermission(session, "billing:manage")) {
    return forbidden("billing:manage");
  }

  if (!body.planId || !planIds.has(body.planId)) {
    return NextResponse.json({ error: "Choose a valid plan." }, { status: 400 });
  }

  if (!isStripeConfigured()) {
    const repository = getWorkspaceRepository();
    const workspace = await repository.updateBillingPlan(
      session.businessId,
      body.planId,
    );

    return NextResponse.json({
      mode: "demo",
      workspace: presentWorkspace(workspace, session),
    });
  }

  const priceId = getStripePriceId(body.planId);

  if (!priceId) {
    return NextResponse.json(
      { error: `Missing Stripe price ID for ${body.planId}.` },
      { status: 400 },
    );
  }

  const repository = getWorkspaceRepository();
  const billing = await repository.readBillingState(session.businessId);
  const checkout = await createCheckoutSession({
    businessId: session.businessId,
    customerEmail: session.user.email,
    customerId: billing.stripeCustomerId,
    planId: body.planId,
    priceId,
    returnUrl: new URL("/", request.url).toString(),
  });

  return NextResponse.json({ mode: "stripe", url: checkout.url });
}
