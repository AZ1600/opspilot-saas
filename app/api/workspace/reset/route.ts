import { NextResponse } from "next/server";
import { presentWorkspace, requireSession } from "@/lib/server/auth";
import { forbidden, hasPermission } from "@/lib/server/permissions";
import { canResetDemoWorkspace } from "@/lib/server/demo-reset";
import { getWorkspaceRepository } from "@/lib/server/repository";

export const runtime = "nodejs";

export async function POST() {
  const session = await requireSession();
  if (!hasPermission(session, "workspace:reset")) {
    return forbidden("workspace:reset");
  }

  if (!canResetDemoWorkspace(session)) {
    return NextResponse.json(
      { error: "Reset is available only for the local demo workspace." },
      { status: 403 },
    );
  }

  const repository = getWorkspaceRepository();
  const workspace = await repository.reset(session.businessId);

  return NextResponse.json({ workspace: presentWorkspace(workspace, session) });
}
