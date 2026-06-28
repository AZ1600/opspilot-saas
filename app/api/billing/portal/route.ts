import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/server/auth";
import { forbidden, hasPermission } from "@/lib/server/permissions";
import { getWorkspaceRepository } from "@/lib/server/repository";
import { createPortalSession, isStripeConfigured } from "@/lib/server/stripe";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const session = await requireSession();

  if (!hasPermission(session, "billing:manage")) {
    return forbidden("billing:manage");
  }

  if (!isStripeConfigured()) {
    return NextResponse.json(
      { error: "Stripe billing is not configured." },
      { status: 501 },
    );
  }

  const repository = getWorkspaceRepository();
  const billing = await repository.readBillingState(session.businessId);

  if (!billing.stripeCustomerId) {
    return NextResponse.json(
      { error: "Start a subscription before opening the billing portal." },
      { status: 400 },
    );
  }

  const portal = await createPortalSession({
    customerId: billing.stripeCustomerId,
    returnUrl: new URL("/", request.url).toString(),
  });

  return NextResponse.json({ url: portal.url });
}
