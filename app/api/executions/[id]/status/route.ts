import { NextRequest, NextResponse } from "next/server";
import { presentWorkspace, requireSession } from "@/lib/server/auth";
import { forbidden, hasPermission } from "@/lib/server/permissions";
import { getWorkspaceRepository } from "@/lib/server/repository";
import type { ExecutionStatus } from "@/lib/server/workspace-repository";

export const runtime = "nodejs";

const allowedStatuses = new Set<ExecutionStatus>(["completed", "failed"]);

function isExecutionStatus(status: unknown): status is ExecutionStatus {
  return typeof status === "string" && allowedStatuses.has(status as ExecutionStatus);
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const session = await requireSession();

  if (!hasPermission(session, "actions:approve")) {
    return forbidden("actions:approve");
  }

  const { id } = await context.params;
  const body = (await request.json()) as { status?: ExecutionStatus };

  if (!isExecutionStatus(body.status)) {
    return NextResponse.json(
      { error: "Status must be completed or failed." },
      { status: 400 },
    );
  }

  const repository = getWorkspaceRepository();
  const workspace = await repository.updateExecutionJobStatus(
    session.businessId,
    id,
    body.status,
  );

  if (!workspace) {
    return NextResponse.json({ error: "Execution job not found." }, { status: 404 });
  }

  return NextResponse.json({ workspace: presentWorkspace(workspace, session) });
}
