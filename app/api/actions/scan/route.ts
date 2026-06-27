import { NextResponse } from "next/server";
import { createScanResult } from "@/lib/ai/scan-engine";
import { presentWorkspace, requireSession } from "@/lib/server/auth";
import { forbidden, hasPermission } from "@/lib/server/permissions";
import { getWorkspaceRepository } from "@/lib/server/repository";

export const runtime = "nodejs";

export async function POST() {
  const session = await requireSession();
  if (!hasPermission(session, "inbox:scan")) {
    return forbidden("inbox:scan");
  }

  const repository = getWorkspaceRepository();
  const result = createScanResult();
  const workspace = await repository.addScan(session.businessId, {
    actions: [result.action],
    revenueLeaks: [result.revenueLeak],
  });

  return NextResponse.json({
    ...result,
    workspace: presentWorkspace(workspace, session),
  });
}
