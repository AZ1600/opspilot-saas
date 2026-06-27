import { NextRequest, NextResponse } from "next/server";
import { presentWorkspace, requireSession } from "@/lib/server/auth";
import { forbidden, hasPermission } from "@/lib/server/permissions";
import { getWorkspaceRepository } from "@/lib/server/repository";
import type { ActionStatus } from "@/lib/types";

export const runtime = "nodejs";

type DecisionStatus = Extract<ActionStatus, "approved" | "dismissed">;

const allowedStatuses = new Set<ActionStatus>(["approved", "dismissed"]);

function isDecisionStatus(status: unknown): status is DecisionStatus {
  return typeof status === "string" && allowedStatuses.has(status as ActionStatus);
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const session = await requireSession();
  if (!hasPermission(session, "actions:approve")) {
    return forbidden("actions:approve");
  }

  const repository = getWorkspaceRepository();
  const { id } = await context.params;
  const body = (await request.json()) as { status?: ActionStatus };

  if (!isDecisionStatus(body.status)) {
    return NextResponse.json(
      { error: "Status must be approved or dismissed." },
      { status: 400 },
    );
  }

  const workspace = await repository.updateActionDecision(
    session.businessId,
    id,
    body.status,
    session.user.fullName,
  );

  if (!workspace) {
    return NextResponse.json({ error: "Action not found." }, { status: 404 });
  }

  return NextResponse.json({ workspace: presentWorkspace(workspace, session) });
}
