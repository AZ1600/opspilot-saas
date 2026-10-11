import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { POST as reset } from "@/app/api/workspace/reset/route";
import { fileWorkspaceRepository as repository, writeWorkspace } from "@/lib/server/workspace-store";
import { demoWorkspace } from "@/lib/demo-data";
import { CommandCenter } from "@/components/command-center";
import type { RequestSession } from "@/lib/server/auth";

const mocks = vi.hoisted(() => ({ session: vi.fn() }));
vi.mock("@/lib/server/auth", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/server/auth")>(), requireSession: mocks.session,
}));
vi.mock("@/lib/server/repository", async () => {
  const { fileWorkspaceRepository } = await import("@/lib/server/workspace-store");
  return { getWorkspaceRepository: () => fileWorkspaceRepository };
});
vi.mock("@clerk/nextjs", () => ({ UserButton: () => null, SignOutButton: ({ children }: { children: ReactNode }) => children }));
let directory: string;
let resetSpy: ReturnType<typeof vi.spyOn>;
const session: RequestSession = {
  businessId: demoWorkspace.businessId, user: { ...demoWorkspace.currentUser },
};
beforeAll(async () => { directory = await mkdtemp(join(tmpdir(), "opspilot-demo-reset-")); });
beforeEach(async () => {
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("OPSPILOT_FILE_STORAGE_DIR", directory);
  vi.stubEnv("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", "");
  vi.stubEnv("CLERK_SECRET_KEY", "");
  mocks.session.mockReset().mockResolvedValue(session);
  resetSpy = vi.spyOn(repository, "reset");
  await writeWorkspace(session.businessId, { ...demoWorkspace,
    businessName: "Protected saved business", billingPlan: { ...demoWorkspace.billingPlan, id: "pro" },
    currentUser: { ...session.user, fullName: "Saved profile" },
    actions: [],
  });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });
afterAll(async () => { await rm(directory, { recursive: true, force: true }); });
async function unchangedAfterDeniedReset() {
  const path = join(directory, session.businessId + ".json");
  const before = await readFile(path, "utf8");
  const response = await reset();
  expect(response.status).toBe(403);
  expect(resetSpy).not.toHaveBeenCalled();
  expect(await readFile(path, "utf8")).toBe(before);
}

describe("demo workspace reset boundary", () => {
  it.each([false, true])("blocks production reset without changing data, Clerk configured=%s", async (configured) => {
    vi.stubEnv("NODE_ENV", "production");
    if (configured) {
      vi.stubEnv("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", "pk_test_example");
      vi.stubEnv("CLERK_SECRET_KEY", "sk_test_example");
    }
    await unchangedAfterDeniedReset();
  });
  it.each([["pk_test_example", "sk_test_example"], ["pk_test_example", ""], ["", "sk_test_example"]])(
    "blocks complete or partial Clerk configuration: %s / %s", async (publishable, secret) => {
      vi.stubEnv("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", publishable);
      vi.stubEnv("CLERK_SECRET_KEY", secret);
      await unchangedAfterDeniedReset();
    },
  );
  it("blocks a different business even when the session uses the demo owner ID", async () => {
    mocks.session.mockResolvedValue({ ...session, businessId: "another-business",
      user: { ...session.user, businessId: "another-business" },
    });
    await unchangedAfterDeniedReset();
  });
  it("blocks a non-demo owner ID in the canonical demo business", async () => {
    mocks.session.mockResolvedValue({ ...session, user: { ...session.user, id: "clerk-real-owner" } });
    await unchangedAfterDeniedReset();
  });
  it("blocks inconsistent session and user business IDs", async () => {
    mocks.session.mockResolvedValue({ ...session, user: { ...session.user, businessId: "another-business" } });
    await unchangedAfterDeniedReset();
  });
  it.each(["manager", "staff"] as const)("keeps %s unable to reset", async (role) => {
    mocks.session.mockResolvedValue({ ...session, user: { ...session.user, role } });
    await unchangedAfterDeniedReset();
  });
  it.each(["development", "test"])("allows the local demo owner to reset in %s", async (environment) => {
    vi.stubEnv("NODE_ENV", environment);
    const response = await reset();
    expect(response.status).toBe(200);
    expect(resetSpy).toHaveBeenCalledExactlyOnceWith(demoWorkspace.businessId);
    const { workspace } = await response.json();
    expect(workspace.businessName).toBe(demoWorkspace.businessName);
    expect(workspace.currentUser.id).toBe(demoWorkspace.currentUser.id);
    expect(workspace.actions).toEqual(demoWorkspace.actions);
  });
  it("does not access reset storage before an authenticated session is available", async () => {
    mocks.session.mockRejectedValue(new Error("Sign in required"));
    await expect(reset()).rejects.toThrow("Sign in required");
    expect(resetSpy).not.toHaveBeenCalled();
  });
});

describe("visible reset controls", () => {
  function render(authMode: "clerk" | "demo", enabled: boolean, isPublicDemo = false) {
    return renderToStaticMarkup(createElement(CommandCenter, {
      authMode, demoResetEnabled: enabled, isPublicDemo,
      initialWorkspace: { ...demoWorkspace, onboardingCompleted: true },
    }));
  }
  it("does not show reset when the server denies the capability", () => {
    expect(render("demo", false)).not.toContain("Reset demo");
  });
  it("does not show reset for Clerk accounts even if a stale capability flag is true", () => {
    expect(render("clerk", true)).not.toContain("Reset demo");
  });
  it("does not show reset in the public demo", () => {
    expect(render("demo", true, true)).not.toContain("Reset demo");
  });
  it("keeps reset visible for an eligible local demo owner", () => {
    expect(render("demo", true)).toContain("Reset demo");
  });
});
