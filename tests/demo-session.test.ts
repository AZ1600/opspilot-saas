import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NextRequest } from "next/server";
import { demoWorkspace } from "@/lib/demo-data";
import { requireSession, sessionCookieName } from "@/lib/server/auth";
import { fileWorkspaceRepository as repository } from "@/lib/server/workspace-store";
import { POST as login } from "@/app/api/auth/login/route";
import { PATCH as decide } from "@/app/api/actions/[id]/status/route";
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

function approvalRequest() {
  return new NextRequest("http://localhost/api/actions/" + action.id + "/status", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status: "approved" }),
  });
}

describe("demo session membership", () => {
  it.each(["owner", "manager"] as const)(
    "registers the demo %s and attributes an approval after login",
    async (role) => {
      const user = await loginAs(role);
      const response = await decide(approvalRequest(), {
        params: Promise.resolve({ id: action.id }),
      });
      expect(response.status).toBe(200);
      const workspace = await repository.read(demoWorkspace.businessId);
      expect(workspace.teamMembers.find((member) => member.id === user.id)).toMatchObject({
        ...user, status: "active",
      });
      expect(workspace.approvalEvents[0]).toMatchObject({
        actorId: user.id, actor: user.fullName, decision: "approved",
      });
      expect(workspace.executionJobs[0].owner).toBe(user.fullName);
    },
  );

  it("keeps demo staff unable to approve actions", async () => {
    await loginAs("staff");
    const response = await decide(approvalRequest(), {
      params: Promise.resolve({ id: action.id }),
    });
    expect(response.status).toBe(403);
    const workspace = await repository.read(demoWorkspace.businessId);
    expect(workspace.actions.find((entry) => entry.id === action.id)?.status).toBe("pending");
    expect(workspace.approvalEvents).toHaveLength(0);
    expect(workspace.executionJobs).toHaveLength(0);
  });

  it("uses a matching manager ID for development fallback sessions", async () => {
    vi.stubEnv("OPSPILOT_DEV_ROLE", "manager");
    vi.stubEnv("OPSPILOT_DEV_USER_NAME", "Fallback Manager");
    const session = await requireSession();
    expect(session.user).toMatchObject({
      id: "user-demo-manager", role: "manager", fullName: "Fallback Manager",
    });
    const approved = await repository.updateActionDecision(
      session.businessId, action.id, "approved", { id: session.user.id },
    );
    expect(approved?.approvalEvents[0].actorId).toBe("user-demo-manager");
  });

  it("resolves repeat sessions without replacing completed jobs or approval history", async () => {
    const user = await loginAs("manager");
    await requireSession();
    const approved = await repository.updateActionDecision(
      user.businessId, action.id, "approved", { id: user.id },
    );
    const finished = await repository.updateExecutionJobStatus(
      user.businessId, approved!.executionJobs[0].id, "completed",
    );
    await requireSession();
    expect(await repository.read(user.businessId)).toEqual(finished);
  });

  it.each([
    { businessId: "another-business" },
    { id: "another-user" },
    { email: "another@example.test" },
  ])("rejects noncanonical demo identities: %j", async (changes) => {
    const before = await repository.read(demoWorkspace.businessId);
    await expect(repository.resolveDemoSession({ ...demoUser("manager"), ...changes }))
      .rejects.toThrow("Invalid demo session identity.");
    expect(await repository.read(demoWorkspace.businessId)).toEqual(before);
  });
});

describe("demo authentication boundaries", () => {
  it("refuses demo login in production without issuing a cookie", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const response = await login(new NextRequest("http://localhost/api/auth/login", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: "{",
    }));
    expect(response.status).toBe(403);
    expect(response.headers.get("set-cookie")).toBeNull();
    await expect(requireSession()).rejects.toThrow("Demo authentication is disabled in production.");
  });

  it("refuses repository demo registration in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const before = await repository.read(demoWorkspace.businessId);
    await expect(repository.resolveDemoSession(demoUser("manager")))
      .rejects.toThrow("Demo authentication is disabled in production.");
    expect(await repository.read(demoWorkspace.businessId)).toEqual(before);
  });

  it("refuses demo login when Clerk is configured", async () => {
    vi.stubEnv("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", "pk_test_example");
    vi.stubEnv("CLERK_SECRET_KEY", "sk_test_example");
    const response = await login(new NextRequest("http://localhost/api/auth/login", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: "owner" }),
    }));
    expect(response.status).toBe(403);
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("continues resolving real Clerk sessions in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", "pk_test_example");
    vi.stubEnv("CLERK_SECRET_KEY", "sk_test_example");
    mocks.clerkUser.mockResolvedValue({
      id: "real-clerk-demo-regression",
      primaryEmailAddress: { emailAddress: "real-clerk@example.test" },
      emailAddresses: [], fullName: "Clerk Test User", firstName: "Clerk", lastName: "Test User",
    });
    const session = await requireSession();
    expect(session.user).toMatchObject({
      id: "clerk-real-clerk-demo-regression", fullName: "Clerk Test User", role: "owner",
    });
    expect(session.businessId).not.toBe(demoWorkspace.businessId);
  });
});

describe("demo login request validation", () => {
  it.each(["{", "null", "[]", '{"role":42}', '{"role":"owner","fullName":42}'])(
    "returns 400 for an invalid login body: %s", async (body) => {
      const response = await login(new NextRequest("http://localhost/api/auth/login", {
        method: "POST", headers: { "Content-Type": "application/json" }, body,
      }));
      expect(response.status).toBe(400);
      expect(response.headers.get("set-cookie")).toBeNull();
    },
  );

  it("accepts an HTML form login", async () => {
    const response = await login(new NextRequest("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ role: "manager", fullName: "Form Manager" }),
    }));
    expect(response.status).toBe(303);
    expect(response.cookies.get(sessionCookieName)?.value).toBeTruthy();
  });

  it("rejects an unsupported role", async () => {
    const response = await login(new NextRequest("http://localhost/api/auth/login", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: "administrator" }),
    }));
    expect(response.status).toBe(400);
    expect(response.headers.get("set-cookie")).toBeNull();
  });
});
