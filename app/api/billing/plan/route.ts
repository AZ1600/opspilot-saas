import { NextRequest, NextResponse } from "next/server";
import { presentWorkspace, requireSession } from "@/lib/server/auth";
import { forbidden, hasPermission } from "@/lib/server/permissions";
import { getWorkspaceRepository } from "@/lib/server/repository";
import { badRequest, readJsonObject, validatePlanId } from "@/lib/server/request-validation";

export const runtime = "nodejs";

export async function PATCH(request: NextRequest) {
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

  const repository = getWorkspaceRepository();
  const workspace = await repository.updateBillingPlan(session.businessId, validated.value);
  return NextResponse.json({ workspace: presentWorkspace(workspace, session) });
}
