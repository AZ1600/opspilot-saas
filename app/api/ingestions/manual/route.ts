import { NextRequest, NextResponse } from "next/server";
import { classifyManualInputWithProvider } from "@/lib/ai/openai-ingestion";
import { presentWorkspace, requireSession } from "@/lib/server/auth";
import { forbidden, hasPermission } from "@/lib/server/permissions";
import { getWorkspaceRepository } from "@/lib/server/repository";
import { badRequest, readJsonObject, validateManualInput } from "@/lib/server/request-validation";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const session = await requireSession();
  if (!hasPermission(session, "ingestions:create")) {
    return forbidden("ingestions:create");
  }

  const parsed = await readJsonObject(request);
  if (!parsed.ok) {
    return badRequest(parsed.error);
  }
  const validated = validateManualInput(parsed.value);
  if (!validated.ok) {
    return badRequest(validated.error);
  }

  const repository = getWorkspaceRepository();
  const ingestion = await classifyManualInputWithProvider(validated.value);
  const workspace = await repository.addIngestion(session.businessId, ingestion);
  return NextResponse.json({ ingestion, workspace: presentWorkspace(workspace, session) });
}
