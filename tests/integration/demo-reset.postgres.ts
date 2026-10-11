import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { getDatabasePool } from "@/lib/server/database";
import { postgresWorkspaceRepository } from "@/lib/server/postgres-repository";
import { POST as reset } from "@/app/api/workspace/reset/route";
import { authenticatedBusinessId } from "@/lib/server/authenticated-identity";
import type { BusinessAction, WorkspaceUser } from "@/lib/types";
import { demoWorkspace } from "@/lib/demo-data";

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
  vi.restoreAllMocks();
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

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", "");
  vi.stubEnv("CLERK_SECRET_KEY", "");
  mocks.session.mockReset();
});
const owner: WorkspaceUser = { ...demoWorkspace.currentUser, fullName: "Reset Test Owner" };
async function prepareDemo() {
  const existing = await getDatabasePool().query("select id from businesses where id = $1", [owner.businessId]);
  if (existing.rowCount) throw new Error("Demo reset fixture already exists in the isolated test database.");
  fixtureBusinesses.push(owner.businessId);
  const session = await postgresWorkspaceRepository.resolveDemoSession(owner, { updateName: true });
  await postgresWorkspaceRepository.updateSettings(owner.businessId, {
    businessName: "Protected stored business", ownerName: "Saved Owner", niche: "Cleaning services", primaryPainPoint: "missed_leads",
  });
  await postgresWorkspaceRepository.updateStripeBilling({
    businessId: owner.businessId, customerId: "test-reset-customer-" + randomUUID(),
    subscriptionId: "test-reset-subscription-" + randomUUID(), status: "active", planId: "pro",
  });
  mocks.session.mockResolvedValue(session);
  return session;
}
async function deniedWithoutChanges(businessId: string) {
  const before = await postgresWorkspaceRepository.read(businessId);
  const billing = await postgresWorkspaceRepository.readBillingState(businessId);
  const users = (await getDatabasePool().query("select * from users where business_id = $1 order by id", [businessId])).rows;
  const spy = vi.spyOn(postgresWorkspaceRepository, "reset");
  expect((await reset()).status).toBe(403);
  expect(spy).not.toHaveBeenCalled();
  expect(await postgresWorkspaceRepository.read(businessId)).toEqual(before);
  expect(await postgresWorkspaceRepository.readBillingState(businessId)).toEqual(billing);
  expect((await getDatabasePool().query("select * from users where business_id = $1 order by id", [businessId])).rows).toEqual(users);
}

describe("PostgreSQL demo reset boundary", () => {
  it("preserves stored data and billing identifiers when production reset is refused", async () => {
    const session = await prepareDemo();
    vi.stubEnv("NODE_ENV", "production");
    await deniedWithoutChanges(session.businessId);
  });
  it("preserves stored data when Clerk is configured outside production", async () => {
    const session = await prepareDemo();
    vi.stubEnv("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", "pk_test_example");
    vi.stubEnv("CLERK_SECRET_KEY", "sk_test_example");
    await deniedWithoutChanges(session.businessId);
  });
  it("preserves a real account binding and business even in a development environment", async () => {
    const identity = { provider: "clerk" as const, emailVerified: true as const,
      providerUserId: "reset-protected-" + randomUUID(), email: randomUUID() + "@example.test", fullName: "Bound Owner",
    };
    const businessId = authenticatedBusinessId(identity);
    fixtureBusinesses.push(businessId);
    const session = await postgresWorkspaceRepository.resolveAuthenticatedSession(identity);
    mocks.session.mockResolvedValue(session);
    await deniedWithoutChanges(businessId);
  });
  it("allows the eligible local demo owner to restore the demo workspace", async () => {
    await prepareDemo();
    const response = await reset();
    expect(response.status).toBe(200);
    const workspace = await postgresWorkspaceRepository.read(owner.businessId);
    expect(workspace.businessName).toBe(demoWorkspace.businessName);
    expect(workspace.currentUser.id).toBe(owner.id);
    expect(workspace.actions).toHaveLength(demoWorkspace.actions.length);
    expect(await postgresWorkspaceRepository.readBillingState(owner.businessId)).toEqual({
      stripeCustomerId: null, stripeSubscriptionId: null, subscriptionStatus: null,
    });
  });
  it("resets the local demo after approvals without deleting another business's records", async () => {
    const session = await prepareDemo();
    const action: BusinessAction = { ...demoWorkspace.actions[0], id: "reset-approved-action", status: "pending" };
    await postgresWorkspaceRepository.addScan(session.businessId, { actions: [action], revenueLeaks: [] });
    await postgresWorkspaceRepository.updateActionDecision(session.businessId, action.id, "approved", { id: owner.id });
    const identity = { provider: "clerk" as const, emailVerified: true as const,
      providerUserId: "reset-other-" + randomUUID(), email: randomUUID() + "@example.test", fullName: "Other Owner",
    };
    const otherId = authenticatedBusinessId(identity); fixtureBusinesses.push(otherId);
    const other = await postgresWorkspaceRepository.resolveAuthenticatedSession(identity);
    await postgresWorkspaceRepository.updateActionDecision(other.businessId, demoWorkspace.actions[0].id, "approved", { id: other.user.id });
    const otherBefore = await postgresWorkspaceRepository.read(other.businessId);
    expect((await reset()).status).toBe(200);
    const workspace = await postgresWorkspaceRepository.read(session.businessId);
    expect(workspace.approvalEvents).toHaveLength(0);
    expect(workspace.executionJobs).toHaveLength(0);
    expect(await postgresWorkspaceRepository.read(other.businessId)).toEqual(otherBefore);
  });
});
