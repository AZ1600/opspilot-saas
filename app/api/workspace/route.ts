import { NextResponse } from "next/server";
import { presentWorkspace, requireSession } from "@/lib/server/auth";
import { getWorkspaceRepository } from "@/lib/server/repository";

export const runtime = "nodejs";

export async function GET() {
  const session = await requireSession();
  const repository = getWorkspaceRepository();
  const workspace = await repository.read(session.businessId);

  return NextResponse.json({ workspace: presentWorkspace(workspace, session) });
}
