import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { getDatabasePool } from "@/lib/server/database";
import { postgresWorkspaceRepository } from "@/lib/server/postgres-repository";
import type { BusinessAction, WorkspaceUser } from "@/lib/types";
import { demoWorkspace } from "@/lib/demo-data";

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

const manager: WorkspaceUser = {
  id: "user-demo-manager",
  businessId: demoWorkspace.businessId,
  email: "manager@brightops.example",
  fullName: "Demo Regression Manager",
  role: "manager",
};

beforeEach(async () => {
  vi.stubEnv("NODE_ENV", "test");
  const existing = await getDatabasePool().query(
    "select id from businesses where id = $1",
    [demoWorkspace.businessId],
  );
  if (existing.rowCount) {
    throw new Error("Demo integration fixture already exists in the test database.");
  }
  // Claim only a fixture verified absent, so cleanup never deletes existing data.
  fixtureBusinesses.push(demoWorkspace.businessId);
});

async function approveDemoAction() {
  const session = await postgresWorkspaceRepository.resolveDemoSession(manager);
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
  await postgresWorkspaceRepository.addScan(session.businessId, {
    actions: [action], revenueLeaks: [],
  });
  const approved = await postgresWorkspaceRepository.updateActionDecision(
    session.businessId, action.id, "approved", { id: session.user.id },
  );
  return { session, action, approved };
}

async function createOtherBusiness(userId = "other-user-" + randomUUID()) {
  const businessId = "test-demo-other-" + randomUUID();
  fixtureBusinesses.push(businessId);
  await getDatabasePool().query(
    "insert into businesses (id, name, niche) values ($1, $2, $3)",
    [businessId, "Another Business", "Test operations"],
  );
  await getDatabasePool().query(
    "insert into users (id, business_id, email, full_name, role, status) values ($1, $2, $3, $4, $5, 'active')",
    [userId, businessId, userId + "@example.test", "Other Owner", "owner"],
  );
  return { businessId, userId };
}

describe("PostgreSQL demo session membership", () => {
  it("registers the demo manager and records that manager's approval ID", async () => {
    const { session, action, approved } = await approveDemoAction();
    expect(session.user).toEqual(manager);
    expect(approved?.teamMembers.find((user) => user.id === manager.id)).toMatchObject({
      ...manager, status: "active",
    });
    expect(approved?.approvalEvents[0]).toMatchObject({
      actorId: manager.id, actor: manager.fullName,
    });
    const audit = await getDatabasePool().query<{ user_id: string }>(
      "select user_id from approval_events where business_id = $1 and action_id = $2",
      [manager.businessId, action.id],
    );
    expect(audit.rows).toEqual([{ user_id: manager.id }]);
  });

  it("preserves completed work and history when resolving the demo session again", async () => {
    const { approved, action } = await approveDemoAction();
    const job = approved?.executionJobs.find((entry) => entry.actionId === action.id);
    expect(job).toBeDefined();
    const finished = await postgresWorkspaceRepository.updateExecutionJobStatus(
      manager.businessId, job!.id, "completed",
    );
    await postgresWorkspaceRepository.resolveDemoSession(manager);
    expect(await postgresWorkspaceRepository.read(manager.businessId)).toEqual(finished);
  });

  it("refuses to register demo users in another business", async () => {
    const other = await createOtherBusiness();
    const before = await postgresWorkspaceRepository.read(other.businessId);
    await expect(postgresWorkspaceRepository.resolveDemoSession({
      ...manager, businessId: other.businessId,
    })).rejects.toThrow("Invalid demo session identity.");
    expect(await postgresWorkspaceRepository.read(other.businessId)).toEqual(before);
  });

  it("rolls back if the reserved demo user ID belongs to another business", async () => {
    const other = await createOtherBusiness(manager.id);
    const before = await postgresWorkspaceRepository.read(other.businessId);
    await expect(postgresWorkspaceRepository.resolveDemoSession(manager))
      .rejects.toThrow("Demo identity conflicts with an existing user.");
    expect(await postgresWorkspaceRepository.read(other.businessId)).toEqual(before);
    const demo = await getDatabasePool().query(
      "select id from businesses where id = $1", [manager.businessId],
    );
    expect(demo.rowCount).toBe(0);
  });

  it("refuses demo registration in production without creating a business", async () => {
    vi.stubEnv("NODE_ENV", "production");
    await expect(postgresWorkspaceRepository.resolveDemoSession(manager))
      .rejects.toThrow("Demo authentication is disabled in production.");
    const demo = await getDatabasePool().query(
      "select id from businesses where id = $1", [manager.businessId],
    );
    expect(demo.rowCount).toBe(0);
  });
});
