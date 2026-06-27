import { NextRequest, NextResponse } from "next/server";
import { presentWorkspace, requireSession } from "@/lib/server/auth";
import { forbidden, hasPermission } from "@/lib/server/permissions";
import { getWorkspaceRepository } from "@/lib/server/repository";
import type { TeamInvite } from "@/lib/types";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const body = (await request.json()) as Partial<TeamInvite>;
  const validationError = validateInvite(body);

  if (validationError) {
    return NextResponse.json({ error: validationError }, { status: 400 });
  }

  const session = await requireSession();
  if (!hasPermission(session, "team:manage")) {
    return forbidden("team:manage");
  }

  const repository = getWorkspaceRepository();
  const workspace = await repository.inviteTeamMember(session.businessId, {
    email: body.email!.trim(),
    fullName: body.fullName!.trim(),
    role: body.role!,
  });

  return NextResponse.json({ workspace: presentWorkspace(workspace, session) });
}

function validateInvite(invite: Partial<TeamInvite>) {
  if (!invite.fullName || invite.fullName.trim().length < 2) {
    return "Full name is required.";
  }

  if (!invite.email || !invite.email.includes("@")) {
    return "Valid email is required.";
  }

  if (invite.role !== "manager" && invite.role !== "staff") {
    return "Role must be manager or staff.";
  }

  return null;
}
