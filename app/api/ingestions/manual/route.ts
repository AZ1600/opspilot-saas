import { NextRequest, NextResponse } from "next/server";
import { classifyManualInputWithProvider } from "@/lib/ai/openai-ingestion";
import { presentWorkspace, requireSession } from "@/lib/server/auth";
import { forbidden, hasPermission } from "@/lib/server/permissions";
import { getWorkspaceRepository } from "@/lib/server/repository";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const body = (await request.json()) as { rawText?: string };
  const rawText = body.rawText?.trim();

  if (!rawText || rawText.length < 20) {
    return NextResponse.json(
      { error: "Paste at least 20 characters of business context." },
      { status: 400 },
    );
  }

  const session = await requireSession();
  if (!hasPermission(session, "ingestions:create")) {
    return forbidden("ingestions:create");
  }

  const repository = getWorkspaceRepository();
  const ingestion = await classifyManualInputWithProvider(rawText);
  const workspace = await repository.addIngestion(session.businessId, ingestion);

  return NextResponse.json({
    ingestion,
    workspace: presentWorkspace(workspace, session),
  });
}
