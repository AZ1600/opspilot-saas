import { describe, expect, it } from "vitest";
import { fileWorkspaceRepository } from "@/lib/server/workspace-store";
import type { BusinessAction } from "@/lib/types";

describe("approval retries", () => {
  it.each(["completed", "failed"] as const)(
    "preserves %s work and approval history",
    async (status) => {
      const businessId = `test-approval-idempotency-${status}`;

      await fileWorkspaceRepository.reset(businessId);

      const action: BusinessAction = {
        id: "retry-safe-action",
        age: "new",
        customer: "Test Customer",
        draft: "Follow up on the outstanding invoice.",
        priority: "urgent",
        reasonCodes: ["invoice"],
        source: "Gmail",
        status: "pending",
        summary: "An outstanding invoice needs follow-up.",
        title: "Resolve invoice issue",
        value: 100,
      };

      await fileWorkspaceRepository.addScan(businessId, {
        actions: [action],
        revenueLeaks: [],
      });

      const approved = await fileWorkspaceRepository.updateActionDecision(
        businessId,
        action.id,
        "approved",
        "Test Owner",
      );

      const originalJob = approved?.executionJobs.find(
        (job) => job.actionId === action.id,
      );

      if (!originalJob) {
        throw new Error("Test setup failed: approval created no job.");
      }

      const finishedWorkspace =
        await fileWorkspaceRepository.updateExecutionJobStatus(
          businessId,
          originalJob.id,
          status,
        );

      const finishedJob = finishedWorkspace?.executionJobs.find(
        (job) => job.id === originalJob.id,
      );

      expect(finishedJob).toMatchObject({ status });

      const retried = await fileWorkspaceRepository.updateActionDecision(
        businessId,
        action.id,
        "approved",
        "Test Owner",
      );

      expect(
        retried?.executionJobs.filter((job) => job.actionId === action.id),
      ).toEqual([finishedJob]);

      expect(
        retried?.approvalEvents.filter((event) => event.actionId === action.id),
      ).toHaveLength(1);
    },
  );
});