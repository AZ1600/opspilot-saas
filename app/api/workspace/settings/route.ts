import { NextRequest, NextResponse } from "next/server";
import { presentWorkspace, requireSession } from "@/lib/server/auth";
import { forbidden, hasPermission } from "@/lib/server/permissions";
import { getWorkspaceRepository } from "@/lib/server/repository";
import { badRequest, readJsonObject, validateWorkspaceProfile } from "@/lib/server/request-validation";

export const runtime = "nodejs";

export async function PATCH(request: NextRequest) {
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
  const workspace = await repository.updateSettings(session.businessId, validated.value);
  return NextResponse.json({ workspace: presentWorkspace(workspace, session) });
}
