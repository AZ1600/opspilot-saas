import { NextRequest, NextResponse } from "next/server";
import { classifyManualInputWithProvider } from "@/lib/ai/openai-ingestion";
import { presentWorkspace, requireSession } from "@/lib/server/auth";
import { forbidden, hasPermission } from "@/lib/server/permissions";
import { getWorkspaceRepository } from "@/lib/server/repository";
import type { IngestionInsert } from "@/lib/server/workspace-repository";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const body = (await request.json()) as { messageIds?: string[] };
  const messageIds = body.messageIds ?? [];

  if (messageIds.length === 0) {
    return NextResponse.json(
      { error: "Select at least one inbox message." },
      { status: 400 },
    );
  }

  const session = await requireSession();
  if (!hasPermission(session, "inbox:scan")) {
    return forbidden("inbox:scan");
  }

  const repository = getWorkspaceRepository();
  const workspace = await repository.read(session.businessId);
  const selectedMessages = workspace.inboxMessages.filter((message) =>
    messageIds.includes(message.id),
  );

  if (selectedMessages.length === 0) {
    return NextResponse.json(
      { error: "No matching inbox messages found." },
      { status: 404 },
    );
  }

  const classified = await Promise.all(
    selectedMessages.map((message) =>
      classifyManualInputWithProvider(
        [
          `From: ${message.from}`,
          `Subject: ${message.subject}`,
          message.body,
        ].join("\n"),
        "Gmail",
      ),
    ),
  );
  const merged = mergeClassifications(
    classified.map((classification, index) =>
      uniquifyClassification(classification, selectedMessages[index].id),
    ),
  );
  const nextWorkspace = await repository.addInboxScan(session.businessId, {
    ...merged,
    scannedMessageIds: selectedMessages.map((message) => message.id),
  });

  return NextResponse.json({
    scanned: selectedMessages.length,
    workspace: presentWorkspace(nextWorkspace, session),
  });
}

function uniquifyClassification(
  classification: IngestionInsert,
  messageId: string,
): IngestionInsert {
  return {
    ingestion: {
      ...classification.ingestion,
      id: `${classification.ingestion.id}-${messageId}`,
    },
    actions: classification.actions.map((action) => ({
      ...action,
      id: `${action.id}-${messageId}`,
    })),
    revenueLeaks: classification.revenueLeaks.map((leak) => ({
      ...leak,
      id: `${leak.id}-${messageId}`,
    })),
    customerRisks: classification.customerRisks.map((risk) => ({
      ...risk,
      id: `${risk.id}-${messageId}`,
    })),
  };
}

function mergeClassifications(classified: IngestionInsert[]): IngestionInsert {
  const [first, ...rest] = classified;

  return {
    ingestion: first.ingestion,
    actions: classified.flatMap((item) => item.actions),
    revenueLeaks: classified.flatMap((item) => item.revenueLeaks),
    customerRisks: classified.flatMap((item) => item.customerRisks),
    ...(rest.length > 0
      ? {
          ingestion: {
            ...first.ingestion,
            summary: `${classified.length} Gmail messages scanned into OpsPilot actions.`,
          },
        }
      : {}),
  };
}
