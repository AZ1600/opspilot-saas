import { NextRequest, NextResponse } from "next/server";
import {
  createGmailAuthorizationUrl,
  createMockGmailAccount,
  isRealGmailOAuthConfigured,
} from "@/lib/connectors/gmail";
import { presentWorkspace, requireSession } from "@/lib/server/auth";
import { forbidden, hasPermission } from "@/lib/server/permissions";
import { getWorkspaceRepository } from "@/lib/server/repository";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const session = await requireSession();

  if (!hasPermission(session, "settings:manage")) {
    return forbidden("settings:manage");
  }

  if (isRealGmailOAuthConfigured()) {
    const authorizationUrl = createGmailAuthorizationUrl(session.businessId);

    if (request.headers.get("accept")?.includes("application/json")) {
      return NextResponse.json({ authorizationUrl });
    }

    return NextResponse.redirect(authorizationUrl, 303);
  }

  const repository = getWorkspaceRepository();
  const workspace = await repository.upsertConnectedAccount(
    session.businessId,
    createMockGmailAccount(),
  );

  if (request.headers.get("accept")?.includes("application/json")) {
    return NextResponse.json({
      workspace: presentWorkspace(workspace, session),
    });
  }

  return NextResponse.redirect(new URL("/?view=settings", request.url), 303);
}
