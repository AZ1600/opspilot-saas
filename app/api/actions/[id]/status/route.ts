import { NextRequest, NextResponse } from "next/server";
import { presentWorkspace, requireSession } from "@/lib/server/auth";
import { forbidden, hasPermission } from "@/lib/server/permissions";
import { getWorkspaceRepository } from "@/lib/server/repository";
import type { DecisionStatus } from "@/lib/server/workspace-repository";

export const runtime = "nodejs";

const allowedStatuses = new Set<DecisionStatus>(["approved", "dismissed"]);

function isDecisionStatus(status: unknown): status is DecisionStatus {
  return (
    typeof status === "string" &&
    allowedStatuses.has(status as DecisionStatus)
  );
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
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Request body must be valid JSON." },
      { status: 400 },
    );
  }

  if (
    typeof body !== "object" ||
    body === null ||
    Array.isArray(body) ||
    !("status" in body) ||
    !isDecisionStatus(body.status)
  ) {
    return NextResponse.json(
      { error: "Status must be approved or dismissed." },
      { status: 400 },
    );
  }

  const repository = getWorkspaceRepository();
  const workspace = await repository.updateActionDecision(
    session.businessId,
    id,
    body.status,
    { id: session.user.id },
  );

  if (!workspace) {
    return NextResponse.json({ error: "Action not found." }, { status: 404 });
  }

  return NextResponse.json({ workspace: presentWorkspace(workspace, session) });
}
