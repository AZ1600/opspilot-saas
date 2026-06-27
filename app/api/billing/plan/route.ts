import { NextRequest, NextResponse } from "next/server";
import { billingPlans } from "@/lib/billing";
import { presentWorkspace, requireSession } from "@/lib/server/auth";
import { forbidden, hasPermission } from "@/lib/server/permissions";
import { getWorkspaceRepository } from "@/lib/server/repository";
import type { BillingPlan } from "@/lib/types";

export const runtime = "nodejs";

const planIds = new Set<BillingPlan["id"]>(
  billingPlans.map((plan) => plan.id),
);

export async function PATCH(request: NextRequest) {
  const body = (await request.json()) as { planId?: BillingPlan["id"] };

  if (!body.planId || !planIds.has(body.planId)) {
    return NextResponse.json({ error: "Choose a valid plan." }, { status: 400 });
  }

  const session = await requireSession();
  if (!hasPermission(session, "billing:manage")) {
    return forbidden("billing:manage");
  }

  const repository = getWorkspaceRepository();
  const workspace = await repository.updateBillingPlan(
    session.businessId,
    body.planId,
  );

  return NextResponse.json({ workspace: presentWorkspace(workspace, session) });
}
