import { NextRequest, NextResponse } from "next/server";
import { presentWorkspace, requireSession } from "@/lib/server/auth";
import { forbidden, hasPermission } from "@/lib/server/permissions";
import { OnboardingAlreadyCompletedError, OnboardingOwnerError } from "@/lib/server/onboarding";
import { getWorkspaceRepository } from "@/lib/server/repository";
import { badRequest, readJsonObject, validateWorkspaceProfile } from "@/lib/server/request-validation";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const session = await requireSession();
  if (!hasPermission(session, "settings:manage")) {
    return forbidden("settings:manage");
  }

  const parsed = await readJsonObject(request);
  if (!parsed.ok) {
    return badRequest(parsed.error);
  }
  const validated = validateWorkspaceProfile(parsed.value);
  if (!validated.ok) {
    return badRequest(validated.error);
  }

  const repository = getWorkspaceRepository();
  try {
    const workspace = await repository.onboard(session.businessId, validated.value, session.user);
    return NextResponse.json({ workspace: presentWorkspace(workspace, session) });
  } catch (error) {
    if (error instanceof OnboardingAlreadyCompletedError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    if (error instanceof OnboardingOwnerError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    throw error;
  }
}
