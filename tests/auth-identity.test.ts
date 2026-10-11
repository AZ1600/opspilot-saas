import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { requireSession } from "@/lib/server/auth";
import { fileWorkspaceRepository as repository, writeWorkspace } from "@/lib/server/workspace-store";
import { demoWorkspace } from "@/lib/demo-data";
import type { AuthenticatedIdentity } from "@/lib/server/workspace-repository";

const mocks = vi.hoisted(() => ({ clerkUser: vi.fn(), resolve: vi.fn() }));
vi.mock("@clerk/nextjs/server", () => ({ currentUser: mocks.clerkUser }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error("redirect:" + url); } }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock("@/lib/server/repository", () => ({
  getWorkspaceRepository: () => ({ resolveAuthenticatedSession: mocks.resolve }),
}));

let directory: string;
function identity(id = "user_Alpha", email = "owner@example.test"): AuthenticatedIdentity {
  return { provider: "clerk", providerUserId: id, emailVerified: true, email, fullName: "Identity Owner" };
}
function businessId(value: AuthenticatedIdentity) {
  return "business-" + createHash("sha256").update(JSON.stringify([value.provider, value.providerUserId])).digest("hex");
}
beforeAll(async () => { directory = await mkdtemp(join(tmpdir(), "opspilot-auth-identity-")); });
beforeEach(async () => {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("OPSPILOT_FILE_STORAGE_DIR", directory);
  vi.stubEnv("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", "pk_test_example");
  vi.stubEnv("CLERK_SECRET_KEY", "sk_test_example");
  mocks.clerkUser.mockReset(); mocks.resolve.mockReset();
  for (const name of await readdir(directory)) await rm(join(directory, name));
});
afterEach(() => { vi.unstubAllEnvs(); });
afterAll(async () => { await rm(directory, { recursive: true, force: true }); });

describe("Clerk workspace access boundary", () => {
  it("does not assign a shared fallback email to a phone-only account", async () => {
    mocks.clerkUser.mockResolvedValue({ id: "phone-only", primaryEmailAddress: null, emailAddresses: [] });
    await expect(requireSession()).rejects.toThrow("redirect:/account?issue=email");
    expect(mocks.resolve).not.toHaveBeenCalled();
  });
  it.each([null, { emailAddress: "owner@example.test", verification: null },
    ...["unverified", "failed", "expired", "transferable"].map((status) => ({ emailAddress: "owner@example.test", verification: { status } })),
    { emailAddress: " ", verification: { status: "verified" } },
  ])("requires a verified primary email: %j", async (primaryEmailAddress) => {
    mocks.clerkUser.mockResolvedValue({ id: "user_Alpha", primaryEmailAddress,
      emailAddresses: [{ emailAddress: "secondary@example.test", verification: { status: "verified" } }] });
    await expect(requireSession()).rejects.toThrow("redirect:/account?issue=email");
    expect(mocks.resolve).not.toHaveBeenCalled();
  });
  it("passes only the verified primary email and provider identity", async () => {
    const session = { businessId: "existing-business", user: { id: "stored-member" } };
    mocks.resolve.mockResolvedValue(session);
    mocks.clerkUser.mockResolvedValue({ id: "user_Alpha", fullName: "Identity Owner",
      primaryEmailAddress: { emailAddress: " Owner@Example.Test ", verification: { status: "verified" } },
      emailAddresses: [{ emailAddress: "different@example.test" }],
    });
    expect(await requireSession()).toEqual(session);
    expect(mocks.resolve).toHaveBeenCalledWith(identity());
  });
  it("redirects signed-out users to login before repository access", async () => {
    mocks.clerkUser.mockResolvedValue(null);
    await expect(requireSession()).rejects.toThrow("redirect:/login");
    expect(mocks.resolve).not.toHaveBeenCalled();
  });
  it("offers account recovery for an identity conflict", async () => {
    const { AuthIdentityConflictError } = await import("@/lib/server/authenticated-identity");
    mocks.resolve.mockRejectedValue(new AuthIdentityConflictError());
    mocks.clerkUser.mockResolvedValue({ id: "user_Alpha", primaryEmailAddress: {
      emailAddress: "owner@example.test", verification: { status: "verified" },
    } });
    await expect(requireSession()).rejects.toThrow("redirect:/account?issue=workspace");
  });
  it("does not disguise unrelated repository failures as account conflicts", async () => {
    mocks.resolve.mockRejectedValue(new Error("Database unavailable"));
    mocks.clerkUser.mockResolvedValue({ id: "user_Alpha", primaryEmailAddress: {
      emailAddress: "owner@example.test", verification: { status: "verified" },
    } });
    await expect(requireSession()).rejects.toThrow("Database unavailable");
  });
});

describe("file-backed provider identity isolation", () => {
  it.each([["User_A", "user_a"], ["user-a", "user_a"], ["a/b", "a?b"]])(
    "keeps identities %s and %s in different workspaces", async (first, second) => {
      const a = await repository.resolveAuthenticatedSession(identity(first));
      const before = await repository.read(a.businessId);
      const b = await repository.resolveAuthenticatedSession(identity(second));
      expect(b.businessId).not.toBe(a.businessId);
      expect(b.user.id).not.toBe(a.user.id);
      expect(await repository.read(a.businessId)).toEqual(before);
    },
  );
  it("uses a deterministic lowercase hash for new workspace IDs", async () => {
    const result = await repository.resolveAuthenticatedSession(identity());
    expect(result.businessId).toBe(businessId(identity()));
    expect(result.businessId).toMatch(/^business-[a-f0-9]{64}$/);
    expect((await repository.read(result.businessId)).teamMembers).toHaveLength(1);
  });
  it("retains a legacy workspace only for its exact provider member ID", async () => {
    const legacyId = "business-user-alpha";
    const member = { id: "clerk-user_Alpha", businessId: legacyId, email: "old@example.test",
      fullName: "Stored Owner", role: "owner" as const, status: "active" as const };
    const workspace = { ...demoWorkspace, businessId: legacyId, currentUser: member, teamMembers: [member] };
    await writeWorkspace(legacyId, workspace);
    const before = await readFile(join(directory, legacyId + ".json"), "utf8");
    expect(await repository.resolveAuthenticatedSession(identity())).toMatchObject({ businessId: legacyId, user: { id: member.id, fullName: member.fullName, role: member.role } });
    expect(await readFile(join(directory, legacyId + ".json"), "utf8")).toBe(before);
    expect(await readdir(directory)).toEqual([legacyId + ".json"]);
  });
  it("does not claim or overwrite another identity's legacy slug even with the same email", async () => {
    const legacyId = "business-user-alpha";
    const member = { ...demoWorkspace.currentUser, id: "clerk-user_alpha", businessId: legacyId,
      email: "owner@example.test", status: "active" as const };
    await writeWorkspace(legacyId, { ...demoWorkspace, businessId: legacyId, currentUser: member, teamMembers: [member] });
    const before = await readFile(join(directory, legacyId + ".json"), "utf8");
    const session = await repository.resolveAuthenticatedSession(identity());
    expect(session.businessId).toBe(businessId(identity()));
    expect(await readFile(join(directory, legacyId + ".json"), "utf8")).toBe(before);
  });
  it("resolves by provider ID after an email change without creating another workspace", async () => {
    const first = await repository.resolveAuthenticatedSession(identity());
    const second = await repository.resolveAuthenticatedSession(identity("user_Alpha", "new@example.test"));
    expect(second).toEqual(first);
    expect(await readdir(directory)).toHaveLength(1);
  });
  it("refuses an inactive provider member instead of reactivating it", async () => {
    const session = await repository.resolveAuthenticatedSession(identity());
    const workspace = await repository.read(session.businessId);
    await writeWorkspace(session.businessId, { ...workspace,
      teamMembers: workspace.teamMembers.map((member) => ({ ...member, status: "invited" })),
    });
    await expect(repository.resolveAuthenticatedSession(identity())).rejects.toThrow();
    expect((await repository.read(session.businessId)).teamMembers[0].status).toBe("invited");
  });
  it("refuses an occupied canonical workspace without overwriting its data", async () => {
    const id = businessId(identity());
    await writeWorkspace(id, { ...demoWorkspace, businessId: id });
    const before = await readFile(join(directory, id + ".json"), "utf8");
    await expect(repository.resolveAuthenticatedSession(identity())).rejects.toThrow();
    expect(await readFile(join(directory, id + ".json"), "utf8")).toBe(before);
  });
  it.each([
    { emailVerified: false }, { providerUserId: "" }, { email: "" }, { fullName: "" }, { provider: "other" },
  ])("rejects an invalid trusted identity before file access: %j", async (overrides) => {
    const invalid = { ...identity(), ...overrides } as AuthenticatedIdentity;
    await expect(repository.resolveAuthenticatedSession(invalid)).rejects.toThrow();
    expect(await readdir(directory)).toHaveLength(0);
  });
  it("preserves data during concurrent first sign-ins for the same provider ID", async () => {
    const results = await Promise.all([repository.resolveAuthenticatedSession(identity()), repository.resolveAuthenticatedSession(identity())]);
    expect(results[0]).toEqual(results[1]);
    expect(await readdir(directory)).toHaveLength(1);
  });
});
