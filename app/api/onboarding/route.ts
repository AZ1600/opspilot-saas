import { NextRequest, NextResponse } from "next/server";
import { presentWorkspace, requireSession } from "@/lib/server/auth";
import { forbidden, hasPermission } from "@/lib/server/permissions";
import { getWorkspaceRepository } from "@/lib/server/repository";
import type { OnboardingProfile, PainPoint } from "@/lib/types";

export const runtime = "nodejs";

const painPoints = new Set<PainPoint>([
  "missed_leads",
  "overdue_invoices",
  "customer_complaints",
  "scheduling",
]);

export async function POST(request: NextRequest) {
  const body = (await request.json()) as Partial<OnboardingProfile>;
  const validationError = validateProfile(body);

  if (validationError) {
    return NextResponse.json({ error: validationError }, { status: 400 });
  }

  const session = await requireSession();
  if (!hasPermission(session, "settings:manage")) {
    return forbidden("settings:manage");
  }

  const repository = getWorkspaceRepository();
  const workspace = await repository.onboard(session.businessId, {
    businessName: body.businessName!.trim(),
    ownerName: body.ownerName!.trim(),
    niche: body.niche!.trim(),
    primaryPainPoint: body.primaryPainPoint!,
  }, session.user);

  return NextResponse.json({ workspace: presentWorkspace(workspace, session) });
}

function validateProfile(profile: Partial<OnboardingProfile>) {
  if (!profile.businessName || profile.businessName.trim().length < 2) {
    return "Business name is required.";
  }

  if (!profile.ownerName || profile.ownerName.trim().length < 2) {
    return "Owner name is required.";
  }

  if (!profile.niche || profile.niche.trim().length < 3) {
    return "Industry or niche is required.";
  }

  if (!profile.primaryPainPoint || !painPoints.has(profile.primaryPainPoint)) {
    return "Choose a primary operations problem.";
  }

  return null;
}
