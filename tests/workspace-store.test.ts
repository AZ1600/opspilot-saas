import { describe, expect, it } from "vitest";
import { fileWorkspaceRepository } from "@/lib/server/workspace-store";
import type { BusinessAction } from "@/lib/types";

describe("fileWorkspaceRepository", () => {
  it("creates approval, impact, and execution records when an action is approved", async () => {
    const businessId = "test-business-repository";
    await fileWorkspaceRepository.reset(businessId);

    const action: BusinessAction = {
      id: "test-action-invoice-follow-up",
      age: "new",
      customer: "Northline Dental",
      draft: "Hi Northline Dental, I can resend the invoice link today.",
      priority: "urgent",
      reasonCodes: ["invoice", "urgent signal", "manual ingestion"],
      source: "Gmail",
      status: "pending",
      summary: "Northline Dental has an overdue invoice that needs follow-up.",
      title: "Resolve payment or invoice issue",
      value: 1800,
    };

    await fileWorkspaceRepository.addScan(businessId, {
      actions: [action],
      revenueLeaks: [
        {
          id: "test-leak-invoice-follow-up",
          age: "new",
          customer: action.customer,
          issue: "Invoice/payment issue needs resolution",
          nextMove: action.title,
          source: "Manual paste",
          value: action.value,
        },
      ],
    });

    const approved = await fileWorkspaceRepository.updateActionDecision(
      businessId,
      action.id,
      "approved",
      "Wale Azeez",
    );

    expect(approved).not.toBeNull();
    expect(approved?.actions.find((item) => item.id === action.id)?.status).toBe(
      "approved",
    );
    expect(approved?.approvalEvents[0]).toMatchObject({
      actionId: action.id,
      actor: "Wale Azeez",
      decision: "approved",
    });
    expect(approved?.impactEntries[0]).toMatchObject({
      actionId: action.id,
      amount: 1800,
      category: "invoice_follow_up",
      customer: "Northline Dental",
    });
    expect(approved?.executionJobs[0]).toMatchObject({
      actionId: action.id,
      customer: "Northline Dental",
      owner: "Wale Azeez",
      status: "queued",
      type: "invoice_reminder",
    });

    const completed = await fileWorkspaceRepository.updateExecutionJobStatus(
      businessId,
      approved?.executionJobs[0].id ?? "",
      "completed",
    );

    expect(completed?.executionJobs[0]).toMatchObject({
      actionId: action.id,
      status: "completed",
    });
  });
});
