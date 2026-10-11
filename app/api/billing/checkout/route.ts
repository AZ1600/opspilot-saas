import { NextRequest, NextResponse } from "next/server";
import { getStripePriceId } from "@/lib/billing";
import { presentWorkspace, requireSession } from "@/lib/server/auth";
import { forbidden, hasPermission } from "@/lib/server/permissions";
import { getWorkspaceRepository } from "@/lib/server/repository";
import { createCheckoutSession, isStripeConfigured } from "@/lib/server/stripe";
import { badRequest, readJsonObject, validatePlanId } from "@/lib/server/request-validation";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const session = await requireSession();

  if (!hasPermission(session, "billing:manage")) {
    return forbidden("billing:manage");
  }

  const parsed = await readJsonObject(request);
  if (!parsed.ok) {
    return badRequest(parsed.error);
  }
  const validated = validatePlanId(parsed.value);
  if (!validated.ok) {
    return badRequest(validated.error);
  }
  const planId = validated.value;

  if (!isStripeConfigured()) {
    const repository = getWorkspaceRepository();
    const workspace = await repository.updateBillingPlan(
      session.businessId,
      planId,
    );

    return NextResponse.json({
      mode: "demo",
      workspace: presentWorkspace(workspace, session),
    });
  }

  const priceId = getStripePriceId(planId);

  if (!priceId) {
    return NextResponse.json(
      { error: `Missing Stripe price ID for ${planId}.` },
      { status: 400 },
    );
  }

  const repository = getWorkspaceRepository();
  const billing = await repository.readBillingState(session.businessId);
  const checkout = await createCheckoutSession({
    businessId: session.businessId,
    customerEmail: session.user.email,
    customerId: billing.stripeCustomerId,
    planId: planId,
    priceId,
    returnUrl: new URL("/", request.url).toString(),
  });

  return NextResponse.json({ mode: "stripe", url: checkout.url });
}
