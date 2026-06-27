import { NextRequest, NextResponse } from "next/server";
import {
  createRealGmailAccount,
  exchangeGmailOAuthCode,
  storeGmailToken,
  validateOAuthState,
} from "@/lib/connectors/gmail";
import { requireSession } from "@/lib/server/auth";
import { getWorkspaceRepository } from "@/lib/server/repository";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const session = await requireSession();
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  if (error) {
    return redirectToSettings(request, `gmail_error=${encodeURIComponent(error)}`);
  }

  if (!code || !state || !validateOAuthState(state, session.businessId)) {
    return redirectToSettings(request, "gmail_error=invalid_oauth_state");
  }

  const token = await exchangeGmailOAuthCode(code);
  await storeGmailToken(session.businessId, token);

  const repository = getWorkspaceRepository();
  await repository.upsertConnectedAccount(
    session.businessId,
    createRealGmailAccount(token),
  );

  return redirectToSettings(request, "gmail=connected");
}

function redirectToSettings(request: NextRequest, query: string) {
  return NextResponse.redirect(new URL(`/?view=settings&${query}`, request.url), 303);
}
