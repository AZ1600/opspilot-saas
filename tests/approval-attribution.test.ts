import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileWorkspaceRepository as repository, writeWorkspace } from "@/lib/server/workspace-store";
import type { BusinessAction, TeamMember } from "@/lib/types";

let directory: string;
let businessId: string;
let owner: TeamMember;
let manager: TeamMember;
let invited: TeamMember;

const action: BusinessAction = {
  id: "attribution-action",
  age: "new",
  customer: "Test Customer",
  draft: "Follow up on the outstanding invoice.",
  priority: "urgent",
  reasonCodes: ["invoice"],
  source: "Gmail",
  status: "pending",
  summary: "An invoice requires follow-up.",
  title: "Resolve invoice issue",
  value: 100,
};

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "opspilot-attribution-"));
  vi.stubEnv("OPSPILOT_FILE_STORAGE_DIR", directory);
});

afterAll(async () => {
  vi.unstubAllEnvs();
  if (directory) {
    await rm(directory, { recursive: true, force: true });
  }
});

beforeEach(async () => {
  businessId = "test-attribution-" + randomUUID();
  owner = {
    id: "owner-" + randomUUID(),
    businessId,
    email: "owner@example.test",
    fullName: "Test Owner",
    role: "owner",
    status: "active",
  };
  manager = {
    id: "manager-" + randomUUID(),
    businessId,
    email: "manager@example.test",
    fullName: "Test Manager",
    role: "manager",
    status: "active",
  };
  invited = {
    ...manager,
    id: "invited-" + randomUUID(),
    email: "invited@example.test",
    status: "invited",
  };

  const workspace = await repository.reset(businessId);
  await writeWorkspace(businessId, {
    ...workspace,
    currentUser: owner,
    teamMembers: [owner, manager, invited],
    actions: [action],
    approvalEvents: [],
    executionJobs: [],
    impactEntries: [],
  });
});

describe("file approval attribution", () => {
  it.each(["approved", "dismissed"] as const)(
    "attributes a manager's %s decision to that manager",
    async (decision) => {
      const result = await repository.updateActionDecision(
        businessId, action.id, decision, { id: manager.id },
      );

      expect(result?.approvalEvents).toHaveLength(1);
      expect(result?.approvalEvents[0]).toMatchObject({
        actorId: manager.id,
        actor: manager.fullName,
        decision,
      });
      if (decision === "approved") {
        expect(result?.executionJobs).toHaveLength(1);
        expect(result?.executionJobs[0].owner).toBe(manager.fullName);
      } else {
        expect(result?.executionJobs).toHaveLength(0);
      }
    },
  );

  it("rejects an actor absent from the business without changing its workspace", async () => {
    const before = await repository.read(businessId);
    await expect(repository.updateActionDecision(
      businessId, action.id, "approved", { id: "another-business-owner" },
    )).rejects.toThrow("Approval actor must be an active member of this business.");
    expect(await repository.read(businessId)).toEqual(before);
  });

  it("rejects an invited actor without changing the workspace", async () => {
    const before = await repository.read(businessId);
    await expect(repository.updateActionDecision(
      businessId, action.id, "approved", { id: invited.id },
    )).rejects.toThrow("Approval actor must be an active member of this business.");
    expect(await repository.read(businessId)).toEqual(before);
  });

  it("preserves the original actor when another member retries an approval", async () => {
    const approved = await repository.updateActionDecision(
      businessId, action.id, "approved", { id: manager.id },
    );
    const retried = await repository.updateActionDecision(
      businessId, action.id, "approved", { id: owner.id },
    );
    expect(retried).toEqual(approved);
    expect(retried?.approvalEvents[0].actorId).toBe(manager.id);
  });
});
