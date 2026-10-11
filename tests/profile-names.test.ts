import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NextRequest } from "next/server";
import { demoWorkspace } from "@/lib/demo-data";
import { presentWorkspace, requireSession, sessionCookieName } from "@/lib/server/auth";
import { fileWorkspaceRepository as repository, writeWorkspace } from "@/lib/server/workspace-store";
import { POST as login } from "@/app/api/auth/login/route";
import { PATCH as saveSettings } from "@/app/api/workspace/settings/route";
import { POST as onboard } from "@/app/api/onboarding/route";
import { GET as getWorkspace } from "@/app/api/workspace/route";
import type { BusinessAction, WorkspaceUser } from "@/lib/types";

const mocks = vi.hoisted(() => ({
  cookieGet: vi.fn(),
  clerkUser: vi.fn(),
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: mocks.cookieGet }),
}));
vi.mock("next/navigation", () => ({
  redirect: () => { throw new Error("Redirect to login"); },
}));
vi.mock("@clerk/nextjs/server", () => ({ currentUser: mocks.clerkUser }));
vi.mock("@/lib/server/repository", async () => {
  const { fileWorkspaceRepository } = await import("@/lib/server/workspace-store");
  return { getWorkspaceRepository: () => fileWorkspaceRepository };
});

let directory: string;
const action: BusinessAction = {
  id: "demo-regression-action",
  age: "new",
  customer: "Demo Test Customer",
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
  directory = await mkdtemp(join(tmpdir(), "opspilot-demo-session-"));
});

beforeEach(async () => {
  vi.stubEnv("OPSPILOT_FILE_STORAGE_DIR", directory);
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", "");
  vi.stubEnv("CLERK_SECRET_KEY", "");
  vi.stubEnv("OPSPILOT_DEV_ROLE", "owner");
  vi.stubEnv("OPSPILOT_DEV_USER_NAME", "");
  vi.stubEnv("OPSPILOT_SESSION_SECRET", "test-demo-session-secret");
  mocks.cookieGet.mockReset();
  mocks.clerkUser.mockReset().mockResolvedValue(null);
  await repository.reset(demoWorkspace.businessId);
  await repository.addScan(demoWorkspace.businessId, {
    actions: [action], revenueLeaks: [],
  });
});

afterEach(() => { vi.unstubAllEnvs(); });
afterAll(async () => { await rm(directory, { recursive: true, force: true }); });

function demoUser(role: WorkspaceUser["role"]): WorkspaceUser {
  return {
    id: `user-demo-${role}`,
    businessId: demoWorkspace.businessId,
    email: `${role}@brightops.example`,
    fullName: "Custom Demo " + role,
    role,
  };
}

async function loginAs(role: WorkspaceUser["role"]) {
  const user = demoUser(role);
  const response = await login(new NextRequest("http://localhost/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ role, fullName: user.fullName }),
  }));
  expect(response.status).toBe(303);
  const token = response.cookies.get(sessionCookieName)?.value;
  expect(token).toBeTruthy();
  mocks.cookieGet.mockImplementation((name: string) =>
    name === sessionCookieName ? { value: token } : undefined,
  );
  return user;
}

const profile = {
  businessName: "Saved Business", niche: "Cleaning services",
  ownerName: "Saved Owner Name", primaryPainPoint: "missed_leads" as const,
};
function settingsRequest() {
  return new NextRequest("http://localhost/api/workspace/settings", {
    method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(profile),
  });
}

describe("profile names across real demo login and workspace routes", () => {
  it("returns the saved name immediately after a settings change", async () => {
    await loginAs("owner");
    const response = await saveSettings(settingsRequest());
    expect(response.status).toBe(200);
    const { workspace } = await response.json();
    expect(workspace.currentUser.fullName).toBe(profile.ownerName);
    expect(workspace.teamMembers.find((member: WorkspaceUser) => member.id === "user-demo-owner").fullName).toBe(profile.ownerName);
  });
  it("preserves settings names across repeat requests using the unchanged signed cookie", async () => {
    await loginAs("owner");
    const token = mocks.cookieGet(sessionCookieName).value;
    await saveSettings(settingsRequest());
    expect((await requireSession()).user.fullName).toBe(profile.ownerName);
    expect((await requireSession()).user.fullName).toBe(profile.ownerName);
    const response = await getWorkspace();
    expect((await response.json()).workspace.currentUser.fullName).toBe(profile.ownerName);
    expect(mocks.cookieGet(sessionCookieName).value).toBe(token);
  });
  it("returns and retains the onboarding name instead of the earlier login name", async () => {
    const user = await loginAs("owner");
    const response = await onboard(new NextRequest("http://localhost/api/onboarding", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(profile),
    }));
    expect(response.status).toBe(200);
    const { workspace } = await response.json();
    expect(workspace.currentUser).toMatchObject({ id: user.id, fullName: profile.ownerName });
    expect((await requireSession()).user.fullName).toBe(profile.ownerName);
  });
  it("allows an explicit new demo login to replace the name while retaining saved settings", async () => {
    await loginAs("owner");
    await saveSettings(settingsRequest());
    const response = await login(new NextRequest("http://localhost/api/auth/login", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: "owner", fullName: "  Fresh Login Name  " }),
    }));
    expect(response.status).toBe(303);
    const token = response.cookies.get(sessionCookieName)!.value;
    mocks.cookieGet.mockImplementation(() => ({ value: token }));
    expect((await requireSession()).user.fullName).toBe("Fresh Login Name");
    expect((await repository.read(demoWorkspace.businessId)).businessName).toBe(profile.businessName);
  });
  it("does not replace a saved owner name with the development fallback name", async () => {
    await loginAs("owner");
    await saveSettings(settingsRequest());
    mocks.cookieGet.mockReturnValue(undefined);
    vi.stubEnv("OPSPILOT_DEV_USER_NAME", "Old Development Name");
    expect((await requireSession()).user.fullName).toBe(profile.ownerName);
  });
  it("keeps a previously saved owner name when an older file has a stale team member name", async () => {
    const workspace = await repository.read(demoWorkspace.businessId);
    await writeWorkspace(workspace.businessId, { ...workspace,
      currentUser: { ...workspace.currentUser, fullName: "Previously Saved Name" },
    });
    expect((await requireSession()).user.fullName).toBe("Previously Saved Name");
    expect((await repository.read(workspace.businessId)).teamMembers[0].fullName).toBe("Previously Saved Name");
  });
  it.each(["manager", "staff"] as const)("keeps %s unable to edit settings and preserves the owner's name", async (role) => {
    await loginAs("owner"); await saveSettings(settingsRequest());
    const user = await loginAs(role);
    expect((await saveSettings(settingsRequest())).status).toBe(403);
    const session = await requireSession();
    const response = await getWorkspace();
    const { workspace } = await response.json();
    expect(workspace.currentUser).toMatchObject({ id: user.id, fullName: user.fullName, role });
    expect(session.user.fullName).toBe(user.fullName);
    expect(workspace.teamMembers.find((member: WorkspaceUser) => member.id === "user-demo-owner").fullName).toBe(profile.ownerName);
  });
  it("shows a newly saved Clerk owner's name without replacing the authenticated role or ID", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", "pk_test_example");
    vi.stubEnv("CLERK_SECRET_KEY", "sk_test_example");
    mocks.clerkUser.mockResolvedValue({ id: "clerk-profile-owner", fullName: "Old Clerk Name",
      primaryEmailAddress: { emailAddress: "clerk-owner@example.test", verification: { status: "verified" } },
    });
    const session = await requireSession();
    const response = await saveSettings(settingsRequest());
    expect(response.status).toBe(200);
    const { workspace } = await response.json();
    expect(workspace.currentUser).toEqual({ ...session.user, fullName: profile.ownerName });
    expect((await requireSession()).user).toEqual({ ...session.user, fullName: profile.ownerName });
    expect((await repository.read(session.businessId)).teamMembers[0].fullName).toBe(profile.ownerName);
  });
  it("uses a manager's refreshed member name instead of the workspace owner's name", () => {
    const user = demoUser("manager");
    const workspace = { ...demoWorkspace, teamMembers: [...demoWorkspace.teamMembers,
      { ...user, fullName: "Stored Manager Name", status: "active" as const }],
    };
    expect(presentWorkspace(workspace, { businessId: user.businessId, user }).currentUser)
      .toEqual({ ...user, fullName: "Stored Manager Name" });
  });
  it("does not take a name from a matching member ID scoped to another business", () => {
    const user = demoUser("manager");
    const workspace = { ...demoWorkspace, teamMembers: [{ ...user, businessId: "other-business",
      fullName: "Other Business Name", status: "active" as const }],
    };
    expect(presentWorkspace(workspace, { businessId: user.businessId, user }).currentUser).toEqual(user);
  });
});
