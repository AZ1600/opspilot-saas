import { NextResponse } from "next/server";
import {
  createImportedGmailMessages,
  createMockGmailAccount,
  fetchRealGmailMessages,
  isRealGmailOAuthConfigured,
  markGmailImported,
} from "@/lib/connectors/gmail";
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
  const workspace = await repository.read(session.businessId);
  const gmailAccount =
    workspace.connectedAccounts.find((account) => account.provider === "Gmail") ??
    createMockGmailAccount();

  if (gmailAccount.status !== "connected") {
    return NextResponse.json(
      { error: "Connect Gmail before importing messages." },
      { status: 400 },
    );
  }

  const messages = isRealGmailOAuthConfigured()
    ? await fetchRealGmailMessages(session.businessId)
    : createImportedGmailMessages();
  const nextWorkspace = await repository.importInboxMessages(session.businessId, {
    account: markGmailImported(gmailAccount, messages.length),
    messages,
  });

  return NextResponse.json({
    imported: messages.length,
    workspace: presentWorkspace(nextWorkspace, session),
  });
}
