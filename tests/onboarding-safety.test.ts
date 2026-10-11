import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NextRequest } from "next/server";
import { POST as onboard } from "@/app/api/onboarding/route";
import { fileWorkspaceRepository as repository, writeWorkspace } from "@/lib/server/workspace-store";
import { demoWorkspace } from "@/lib/demo-data";
import type { WorkspaceSnapshot, WorkspaceUser } from "@/lib/types";

const mocks = vi.hoisted(() => ({ session: vi.fn() }));
vi.mock("@/lib/server/auth", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/server/auth")>(), requireSession: mocks.session,
}));
vi.mock("@/lib/server/repository", async () => {
  const { fileWorkspaceRepository } = await import("@/lib/server/workspace-store");
  return { getWorkspaceRepository: () => fileWorkspaceRepository };
});
let directory: string;
const businessId = "test-onboarding-safety";
const owner: WorkspaceUser = { id: "clerk-onboarding-owner", businessId,
  email: "owner@example.test", fullName: "Original Owner", role: "owner",
};
const profile = { businessName: "Set Up Business", niche: "Operations services", ownerName: "Saved Owner", primaryPainPoint: "overdue_invoices" as const };
const preservedCollections = ["actions", "revenueLeaks", "customerRisks", "connectedAccounts", "inboxMessages", "ingestions", "timeline", "approvalEvents", "impactEntries", "executionJobs"] as const;
function request(body = JSON.stringify(profile)) {
  return new NextRequest("http://localhost/api/onboarding", { method: "POST", headers: { "Content-Type": "application/json" }, body });
}
function expectPreserved(before: WorkspaceSnapshot, after: WorkspaceSnapshot) {
  expect(after.billingPlan).toEqual(before.billingPlan);
  for (const key of preservedCollections) expect(after[key], key).toEqual(before[key]);
  expect(after.teamMembers.filter((member) => member.id !== owner.id))
    .toEqual(before.teamMembers.filter((member) => member.id !== owner.id));
}
beforeAll(async () => { directory = await mkdtemp(join(tmpdir(), "opspilot-onboarding-safety-")); });
beforeEach(async () => {
  vi.stubEnv("OPSPILOT_FILE_STORAGE_DIR", directory);
  vi.stubEnv("NODE_ENV", "production");
  mocks.session.mockReset().mockResolvedValue({ businessId, user: owner });
  await writeWorkspace(businessId, { ...demoWorkspace, businessId, currentUser: owner,
    onboardingCompleted: false,
    teamMembers: [
      { ...owner, status: "active" },
      { ...owner, id: "clerk-onboarding-manager", email: "manager@example.test", fullName: "Stored Manager", role: "manager", status: "active" },
      { ...owner, id: "onboarding-invited-staff", email: "staff@example.test", fullName: "Invited Staff", role: "staff", status: "invited" },
    ],
  });
  await repository.updateBillingPlan(businessId, "pro");
  const approved = await repository.updateActionDecision(businessId, demoWorkspace.actions[0].id, "approved", { id: owner.id });
  await repository.updateExecutionJobStatus(businessId, approved!.executionJobs[0].id, "completed");
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });
afterAll(async () => { await rm(directory, { recursive: true, force: true }); });

describe("non-destructive onboarding", () => {
  it("updates the first profile without replacing members, billing or work history", async () => {
    const before = await repository.read(businessId);
    const response = await onboard(request());
    expect(response.status).toBe(200);
    const { workspace } = await response.json();
    expect(workspace).toMatchObject({ businessName: profile.businessName, niche: profile.niche, onboardingCompleted: true });
    expect(workspace.currentUser).toEqual({ ...owner, fullName: profile.ownerName });
    expectPreserved(before, workspace);
    expect(workspace.teamMembers.find((member: WorkspaceUser) => member.id === owner.id).fullName).toBe(profile.ownerName);
  });
  it("accepts an identical retry without writing or replacing stored data", async () => {
    await onboard(request());
    const path = join(directory, businessId + ".json");
    const before = await readFile(path, "utf8");
    const response = await onboard(request());
    expect(response.status).toBe(200);
    expect((await response.json()).workspace.onboardingCompleted).toBe(true);
    expect(await readFile(path, "utf8")).toBe(before);
  });
  it("returns 409 for a different repeated profile without changing data", async () => {
    await onboard(request());
    const before = await repository.read(businessId);
    const response = await onboard(request(JSON.stringify({ ...profile, businessName: "Replacement Business" })));
    expect(response.status).toBe(409);
    expect((await response.json()).error).toContain("Use Settings");
    expect(await repository.read(businessId)).toEqual(before);
  });
  it("serializes concurrent identical submissions without duplicating or losing records", async () => {
    const before = await repository.read(businessId);
    const responses = await Promise.all([onboard(request()), onboard(request())]);
    expect(responses.map((response) => response.status)).toEqual([200, 200]);
    expectPreserved(before, await repository.read(businessId));
  });
  it("allows only one of two different concurrent profiles to initialize the workspace", async () => {
    const before = await repository.read(businessId);
    const second = { ...profile, businessName: "Another First Profile" };
    const responses = await Promise.all([onboard(request()), onboard(request(JSON.stringify(second)))]);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    const stored = await repository.read(businessId);
    expect([profile.businessName, second.businessName]).toContain(stored.businessName);
    expectPreserved(before, stored);
  });
  it("rejects a session owner ID that is not an active owner of the stored business", async () => {
    const before = await repository.read(businessId);
    mocks.session.mockResolvedValue({ businessId, user: { ...owner, id: "foreign-owner" } });
    expect((await onboard(request())).status).toBe(403);
    expect(await repository.read(businessId)).toEqual(before);
  });
  it("rejects mismatched session and user business IDs", async () => {
    const before = await repository.read(businessId);
    mocks.session.mockResolvedValue({ businessId, user: { ...owner, businessId: "other-business" } });
    expect((await onboard(request())).status).toBe(403);
    expect(await repository.read(businessId)).toEqual(before);
  });
  it.each(["manager", "staff"] as const)("keeps %s unable to onboard", async (role) => {
    const before = await repository.read(businessId);
    mocks.session.mockResolvedValue({ businessId, user: { ...owner, role } });
    expect((await onboard(request())).status).toBe(403);
    expect(await repository.read(businessId)).toEqual(before);
  });
  it("does not replace a later settings change when an old onboarding request is retried", async () => {
    await onboard(request());
    await repository.updateSettings(businessId, { ...profile, businessName: "Updated in Settings" });
    const before = await repository.read(businessId);
    expect((await onboard(request())).status).toBe(409);
    expect(await repository.read(businessId)).toEqual(before);
  });
  it("continues validating malformed requests before any onboarding write", async () => {
    const before = await repository.read(businessId);
    expect((await onboard(request("null"))).status).toBe(400);
    expect(await repository.read(businessId)).toEqual(before);
  });
  it("still initializes a genuinely new file workspace", async () => {
    const id = "test-onboarding-fresh";
    await rm(join(directory, id + ".json"), { force: true });
    const fresh = await repository.onboard(id, profile, { ...owner, businessId: id });
    expect(fresh.onboardingCompleted).toBe(true);
    expect(fresh.currentUser.id).toBe(owner.id);
    expect(fresh.actions).toHaveLength(0);
    expect(fresh.teamMembers).toHaveLength(1);
  });
});
