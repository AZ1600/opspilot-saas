import { describe, expect, it } from "vitest";

import { fileWorkspaceRepository } from "@/lib/server/workspace-store";
import type { BusinessAction } from "@/lib/types";

function buildAction(
  id: string,
  customer: string,
  value: number,
): BusinessAction {
  return {
    id,
    age: "new",
    customer,
    draft: `Follow up with ${customer}.`,
    priority: "urgent",
    reasonCodes: ["invoice", "tenant-isolation-test"],
    source: "Gmail",
    status: "pending",
    summary: `${customer} requires follow-up.`,
    title: "Resolve payment or invoice issue",
    value,
  };
}

describe("workspace tenant isolation", () => {
  it("keeps reads and action mutations scoped to the authenticated business", async () => {
    const tenantA = "test-tenant-isolation-a";
    const tenantB = "test-tenant-isolation-b";

    await fileWorkspaceRepository.reset(tenantA);
    await fileWorkspaceRepository.reset(tenantB);

    const sharedActionId = "shared-action-id";

    const actionA = buildAction(
      sharedActionId,
      "Tenant A Customer",
      1500,
    );

    const actionB = buildAction(
      sharedActionId,
      "Tenant B Customer",
      4200,
    );

    await fileWorkspaceRepository.addScan(tenantA, {
      actions: [actionA],
      revenueLeaks: [],
    });

    await fileWorkspaceRepository.addScan(tenantB, {
      actions: [actionB],
      revenueLeaks: [],
    });

    const beforeA =
      await fileWorkspaceRepository.read(tenantA);

    const beforeB =
      await fileWorkspaceRepository.read(tenantB);

    expect(beforeA.businessId).toBe(tenantA);
    expect(beforeB.businessId).toBe(tenantB);

    expect(
      beforeA.actions.find(
        (action) => action.id === sharedActionId,
      ),
    ).toMatchObject({
      customer: "Tenant A Customer",
      status: "pending",
      value: 1500,
    });

    expect(
      beforeB.actions.find(
        (action) => action.id === sharedActionId,
      ),
    ).toMatchObject({
      customer: "Tenant B Customer",
      status: "pending",
      value: 4200,
    });

    const updatedA =
      await fileWorkspaceRepository.updateActionDecision(
        tenantA,
        sharedActionId,
        "approved",
        "Tenant A Owner",
      );

    expect(
      updatedA?.actions.find(
        (action) => action.id === sharedActionId,
      )?.status,
    ).toBe("approved");

    expect(updatedA?.approvalEvents[0]).toMatchObject({
      actionId: sharedActionId,
      actor: "Tenant A Owner",
      decision: "approved",
    });

    const afterB =
      await fileWorkspaceRepository.read(tenantB);

    expect(
      afterB.actions.find(
        (action) => action.id === sharedActionId,
      ),
    ).toMatchObject({
      customer: "Tenant B Customer",
      status: "pending",
      value: 4200,
    });

    expect(
      afterB.approvalEvents.some(
        (event) => event.actionId === sharedActionId,
      ),
    ).toBe(false);

    expect(
      afterB.executionJobs.some(
        (job) => job.actionId === sharedActionId,
      ),
    ).toBe(false);

    expect(
      afterB.impactEntries.some(
        (entry) => entry.actionId === sharedActionId,
      ),
    ).toBe(false);
  });
});

it("keeps workspace settings scoped to the selected business", async () => {
  const tenantA = "test-tenant-settings-a";
  const tenantB = "test-tenant-settings-b";

  await fileWorkspaceRepository.reset(tenantA);
  await fileWorkspaceRepository.reset(tenantB);

  await fileWorkspaceRepository.updateSettings(tenantA, {
    businessName: "Tenant A Operations",
    niche: "Cloud operations",
    ownerName: "Tenant A Owner",
    primaryPainPoint: "missed_leads",
  });

  const workspaceA =
    await fileWorkspaceRepository.read(tenantA);

  const workspaceB =
    await fileWorkspaceRepository.read(tenantB);

  expect(workspaceA).toMatchObject({
    businessId: tenantA,
    businessName: "Tenant A Operations",
    niche: "Cloud operations",
  });

  expect(workspaceA.currentUser.fullName).toBe(
    "Tenant A Owner",
  );

  expect(workspaceB.businessId).toBe(tenantB);

  expect(workspaceB.businessName).not.toBe(
    "Tenant A Operations",
  );

  expect(workspaceB.currentUser.fullName).not.toBe(
    "Tenant A Owner",
  );
});