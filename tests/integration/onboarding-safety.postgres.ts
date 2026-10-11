import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { getDatabasePool } from "@/lib/server/database";
import { postgresWorkspaceRepository } from "@/lib/server/postgres-repository";
import { NextRequest } from "next/server";
import { POST as onboard } from "@/app/api/onboarding/route";
import { demoWorkspace } from "@/lib/demo-data";
import type { WorkspaceSnapshot } from "@/lib/types";
import { authenticatedBusinessId } from "@/lib/server/authenticated-identity";
import type { AuthenticatedIdentity } from "@/lib/server/workspace-repository";

const mocks = vi.hoisted(() => ({ session: vi.fn() }));
vi.mock("@/lib/server/auth", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/server/auth")>(), requireSession: mocks.session,
}));
vi.mock("@/lib/server/repository", async () => {
  const { postgresWorkspaceRepository } = await import("@/lib/server/postgres-repository");
  return { getWorkspaceRepository: () => postgresWorkspaceRepository };
});

const testDatabaseUrl = process.env.OPSPILOT_TEST_DATABASE_URL;

if (!testDatabaseUrl) {
  throw new Error("Set OPSPILOT_TEST_DATABASE_URL for the local test database.");
}

const target = new URL(testDatabaseUrl);

if (
  target.protocol !== "postgresql:" ||
  target.hostname !== "127.0.0.1" ||
  target.port !== "55432" ||
  target.pathname !== "/opspilot_test" ||
  target.username !== "opspilot_test" ||
  target.password !== "opspilot_local_test" ||
  target.search !== "" ||
  target.hash !== ""
) {
  throw new Error("PostgreSQL tests require the isolated local Compose database.");
}

const fixtureBusinesses: string[] = [];
let poolStarted = false;

beforeAll(async () => {
  vi.stubEnv("DATABASE_URL", testDatabaseUrl);
  vi.stubEnv("DATABASE_SSL", "false");
  poolStarted = true;

  const schema = await readFile(
    new URL("../../database/schema.sql", import.meta.url),
    "utf8",
  );

  await getDatabasePool().query(schema);
});

afterEach(async () => {
  const pool = getDatabasePool();

  for (const businessId of fixtureBusinesses) {
    await pool.query("delete from approval_events where business_id = $1", [businessId]);
    await pool.query("delete from businesses where id = $1", [businessId]);
  }

  fixtureBusinesses.length = 0;
});

afterAll(async () => {
  try {
    if (poolStarted) {
      await getDatabasePool().end();
    }
  } finally {
    vi.unstubAllEnvs();
  }
});

const profile = { businessName: "Set Up Business", niche: "Operations services", ownerName: "Saved Owner", primaryPainPoint: "overdue_invoices" as const };
function request(body = profile) {
  return new NextRequest("http://localhost/api/onboarding", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}
async function prepare() {
  const identity: AuthenticatedIdentity = { provider: "clerk", emailVerified: true,
    providerUserId: "onboarding-" + randomUUID(), email: randomUUID() + "@example.test", fullName: "Original Owner",
  };
  const businessId = authenticatedBusinessId(identity); fixtureBusinesses.push(businessId);
  const session = await postgresWorkspaceRepository.resolveAuthenticatedSession(identity);
  await getDatabasePool().query(
    `insert into users (id, business_id, email, full_name, role, status, auth_provider, auth_user_id)
     values ($1, $2, $3, 'Stored Manager', 'manager', 'active', 'clerk', $4)`,
    ["onboarding-manager-" + randomUUID(), businessId, randomUUID() + "@example.test", "manager-provider-" + randomUUID()],
  );
  await getDatabasePool().query(
    `insert into users (id, business_id, email, full_name, role, status)
     values ($1, $2, $3, 'Invited Staff', 'staff', 'invited')`,
    ["onboarding-invite-" + randomUUID(), businessId, randomUUID() + "@example.test"],
  );
  await postgresWorkspaceRepository.updateStripeBilling({ businessId,
    customerId: "test-onboarding-customer-" + randomUUID(), subscriptionId: "test-onboarding-subscription-" + randomUUID(),
    status: "active", planId: "pro",
  });
  const approved = await postgresWorkspaceRepository.updateActionDecision(businessId, demoWorkspace.actions[0].id, "approved", { id: session.user.id });
  await postgresWorkspaceRepository.updateExecutionJobStatus(businessId, approved!.executionJobs[0].id, "completed");
  return session;
}
async function rawBusiness(businessId: string) {
  return (await getDatabasePool().query("select * from businesses where id = $1", [businessId])).rows[0];
}
async function rawMembers(businessId: string) {
  return (await getDatabasePool().query("select * from users where business_id = $1 order by id", [businessId])).rows;
}
function expectPreserved(before: WorkspaceSnapshot, after: WorkspaceSnapshot) {
  expect(after.billingPlan).toEqual(before.billingPlan);
  for (const key of ["actions", "revenueLeaks", "customerRisks", "connectedAccounts", "inboxMessages", "ingestions", "timeline", "approvalEvents", "impactEntries", "executionJobs"] as const) {
    expect(after[key], key).toEqual(before[key]);
  }
}
beforeEach(() => {
  vi.stubEnv("NODE_ENV", "production");
  mocks.session.mockReset();
});

describe("PostgreSQL onboarding preserves established workspace data", () => {
  it("keeps the business row, billing identifiers, team identities and work during first setup", async () => {
    const session = await prepare(); mocks.session.mockResolvedValue(session);
    const before = await postgresWorkspaceRepository.read(session.businessId);
    const billing = await postgresWorkspaceRepository.readBillingState(session.businessId);
    const business = await rawBusiness(session.businessId);
    const users = await rawMembers(session.businessId);
    expect((await onboard(request())).status).toBe(200);
    const after = await postgresWorkspaceRepository.read(session.businessId);
    expect(after).toMatchObject({ onboardingCompleted: true, businessName: profile.businessName });
    expectPreserved(before, after);
    expect(await postgresWorkspaceRepository.readBillingState(session.businessId)).toEqual(billing);
    expect((await rawBusiness(session.businessId)).created_at).toEqual(business.created_at);
    const updatedUsers = await rawMembers(session.businessId);
    expect(updatedUsers).toEqual(users.map((user) => user.id === session.user.id ? { ...user, full_name: profile.ownerName } : user));
    expect((await postgresWorkspaceRepository.resolveAuthenticatedSession({ provider: "clerk", emailVerified: true,
      providerUserId: users.find((user) => user.id === session.user.id).auth_user_id,
      email: session.user.email, fullName: "Clerk Name",
    })).businessId).toBe(session.businessId);
  });
  it("returns the stored workspace for an identical retry without touching records", async () => {
    const session = await prepare(); mocks.session.mockResolvedValue(session);
    await onboard(request());
    const before = await postgresWorkspaceRepository.read(session.businessId);
    const business = await rawBusiness(session.businessId); const users = await rawMembers(session.businessId);
    expect((await onboard(request())).status).toBe(200);
    expect(await postgresWorkspaceRepository.read(session.businessId)).toEqual(before);
    expect(await rawBusiness(session.businessId)).toEqual(business);
    expect(await rawMembers(session.businessId)).toEqual(users);
  });
  it("refuses a changed repeat profile without deleting records or billing state", async () => {
    const session = await prepare(); mocks.session.mockResolvedValue(session);
    await onboard(request());
    const before = await postgresWorkspaceRepository.read(session.businessId);
    const business = await rawBusiness(session.businessId); const users = await rawMembers(session.businessId);
    expect((await onboard(request({ ...profile, businessName: "Replacement Business" }))).status).toBe(409);
    expect(await postgresWorkspaceRepository.read(session.businessId)).toEqual(before);
    expect(await rawBusiness(session.businessId)).toEqual(business);
    expect(await rawMembers(session.businessId)).toEqual(users);
  });
  it("serializes identical concurrent submissions while preserving approvals and billing", async () => {
    const session = await prepare(); mocks.session.mockResolvedValue(session);
    const before = await postgresWorkspaceRepository.read(session.businessId);
    const billing = await postgresWorkspaceRepository.readBillingState(session.businessId);
    const responses = await Promise.all([onboard(request()), onboard(request())]);
    expect(responses.map((response) => response.status)).toEqual([200, 200]);
    expectPreserved(before, await postgresWorkspaceRepository.read(session.businessId));
    expect(await postgresWorkspaceRepository.readBillingState(session.businessId)).toEqual(billing);
  });
  it("permits only one of two different concurrent profiles to initialize the business", async () => {
    const session = await prepare(); mocks.session.mockResolvedValue(session);
    const before = await postgresWorkspaceRepository.read(session.businessId);
    const responses = await Promise.all([onboard(request()), onboard(request({ ...profile, businessName: "Other First Profile" }))]);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    expectPreserved(before, await postgresWorkspaceRepository.read(session.businessId));
  });
  it("cannot substitute another business's owner or change either account binding", async () => {
    const a = await prepare(); const b = await prepare();
    const beforeA = await postgresWorkspaceRepository.read(a.businessId);
    const beforeB = await postgresWorkspaceRepository.read(b.businessId);
    mocks.session.mockResolvedValue({ ...a, user: b.user });
    expect((await onboard(request())).status).toBe(403);
    expect(await postgresWorkspaceRepository.read(a.businessId)).toEqual(beforeA);
    expect(await postgresWorkspaceRepository.read(b.businessId)).toEqual(beforeB);
  });
  it("does not replay old onboarding over a later settings change", async () => {
    const session = await prepare(); mocks.session.mockResolvedValue(session);
    await onboard(request());
    await postgresWorkspaceRepository.updateSettings(session.businessId, { ...profile, businessName: "Changed in Settings" });
    const before = await postgresWorkspaceRepository.read(session.businessId);
    expect((await onboard(request())).status).toBe(409);
    expect(await postgresWorkspaceRepository.read(session.businessId)).toEqual(before);
  });
  it("retains direct initialization for a genuinely absent business", async () => {
    const businessId = "test-onboarding-new-" + randomUUID(); fixtureBusinesses.push(businessId);
    const workspace = await postgresWorkspaceRepository.onboard(businessId, profile, {
      id: "test-onboarding-owner-" + randomUUID(), businessId, email: randomUUID() + "@example.test", fullName: "New Owner", role: "owner",
    });
    expect(workspace.onboardingCompleted).toBe(true);
    expect(workspace.actions).toHaveLength(0);
    expect((await postgresWorkspaceRepository.read(businessId)).businessName).toBe(profile.businessName);
  });
});
