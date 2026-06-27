import { NextRequest, NextResponse } from "next/server";
import { presentWorkspace, requireSession } from "@/lib/server/auth";
import { forbidden, hasPermission } from "@/lib/server/permissions";
import { getWorkspaceRepository } from "@/lib/server/repository";
import type { PainPoint, WorkspaceSettings } from "@/lib/types";

export const runtime = "nodejs";

const painPoints = new Set<PainPoint>([
  "missed_leads",
  "overdue_invoices",
  "customer_complaints",
  "scheduling",
]);

export async function PATCH(request: NextRequest) {
  const body = (await request.json()) as Partial<WorkspaceSettings>;
  const validationError = validateSettings(body);

  if (validationError) {
    return NextResponse.json({ error: validationError }, { status: 400 });
  }

  const session = await requireSession();
  if (!hasPermission(session, "settings:manage")) {
    return forbidden("settings:manage");
  }

  const repository = getWorkspaceRepository();
  const workspace = await repository.updateSettings(session.businessId, {
    businessName: body.businessName!.trim(),
    ownerName: body.ownerName!.trim(),
    niche: body.niche!.trim(),
    primaryPainPoint: body.primaryPainPoint!,
  });

  return NextResponse.json({ workspace: presentWorkspace(workspace, session) });
}

function validateSettings(settings: Partial<WorkspaceSettings>) {
  if (!settings.businessName || settings.businessName.trim().length < 2) {
    return "Business name is required.";
  }

  if (!settings.ownerName || settings.ownerName.trim().length < 2) {
    return "Owner name is required.";
  }

  if (!settings.niche || settings.niche.trim().length < 3) {
    return "Industry or niche is required.";
  }

  if (!settings.primaryPainPoint || !painPoints.has(settings.primaryPainPoint)) {
    return "Choose a primary operations problem.";
  }

  return null;
}
