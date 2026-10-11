import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { getDatabasePool } from "@/lib/server/database";
import { postgresWorkspaceRepository as repository } from "@/lib/server/postgres-repository";
import type { BusinessAction } from "@/lib/types";

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
  throw new Error("PostgreSQL tests require the isolated local test database.");
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
    await pool.query("delete from approval_events where business_id = $1", [
      businessId,
    ]);
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

async function createTenant(label: string, actionId: string) {
  const businessId = "test-tenant-" + randomUUID();
  const userId = "test-owner-" + randomUUID();
  const ownerName = label + " Owner";
  const pool = getDatabasePool();
  fixtureBusinesses.push(businessId);

  await pool.query(
    "insert into businesses (id, name, niche) values ($1, $2, $3)",
    [businessId, label + " Business", "Test operations"],
  );
  await pool.query(
    "insert into users (id, business_id, email, full_name, role, status) values ($1, $2, $3, $4, $5, $6)",
    [userId, businessId, userId + "@example.test", ownerName, "owner", "active"],
  );

  const action: BusinessAction = {
    id: actionId,
    age: "new",
    customer: label + " Customer",
    draft: "Follow up on the outstanding invoice.",
    priority: "urgent",
    reasonCodes: ["invoice", "tenant-isolation-test"],
    source: "Gmail",
    status: "pending",
    summary: label + " has an outstanding invoice.",
    title: "Resolve invoice issue",
    value: label === "Tenant A" ? 1500 : 4200,
  };

  await repository.addScan(businessId, {
    actions: [action],
    revenueLeaks: [],
  });

  return { businessId, ownerName, action, userId };
}

async function approve(tenant: Awaited<ReturnType<typeof createTenant>>) {
  const workspace = await repository.updateActionDecision(
    tenant.businessId,
    tenant.action.id,
    "approved",
    { id: tenant.userId },
  );
  const job = workspace?.executionJobs.find(
    (entry) => entry.actionId === tenant.action.id,
  );

  if (!job) {
    throw new Error("Test setup failed: approval created no execution job.");
  }

  return job;
}

describe("PostgreSQL tenant isolation", () => {
  it("scopes reads and approvals when two businesses share an action ID", async () => {
    const tenantA = await createTenant("Tenant A", "shared-action-id");
    const tenantB = await createTenant("Tenant B", "shared-action-id");
    const beforeA = await repository.read(tenantA.businessId);
    const beforeB = await repository.read(tenantB.businessId);

    expect(beforeA.businessId).toBe(tenantA.businessId);
    expect(beforeA.actions).toEqual([tenantA.action]);
    expect(beforeA.teamMembers).toHaveLength(1);
    expect(beforeA.teamMembers[0].businessId).toBe(tenantA.businessId);
    expect(beforeB.businessId).toBe(tenantB.businessId);
    expect(beforeB.actions).toEqual([tenantB.action]);
    expect(beforeB.teamMembers).toHaveLength(1);
    expect(beforeB.teamMembers[0].businessId).toBe(tenantB.businessId);

    const approvedA = await repository.updateActionDecision(
      tenantA.businessId,
      tenantA.action.id,
      "approved",
      { id: tenantA.userId },
    );

    expect(approvedA?.actions).toEqual([
      { ...tenantA.action, status: "approved" },
    ]);
    expect(approvedA?.approvalEvents).toHaveLength(1);
    expect(approvedA?.approvalEvents[0]).toMatchObject({
      actionId: tenantA.action.id,
      actor: tenantA.ownerName,
      decision: "approved",
    });
    expect(approvedA?.executionJobs).toHaveLength(1);
    expect(approvedA?.executionJobs[0].customer).toBe(tenantA.action.customer);
    expect(approvedA?.impactEntries).toHaveLength(1);
    expect(await repository.read(tenantB.businessId)).toEqual(beforeB);
  });

  it.each(["approved", "dismissed"] as const)(
    "returns null when a business tries to mark another business's action %s",
    async (decision) => {
      const tenantA = await createTenant("Tenant A", "only-in-a");
      const tenantB = await createTenant("Tenant B", "only-in-b");
      const beforeA = await repository.read(tenantA.businessId);
      const beforeB = await repository.read(tenantB.businessId);

      expect(
        await repository.updateActionDecision(
          tenantA.businessId,
          tenantB.action.id,
          decision,
          { id: tenantA.userId },
        ),
      ).toBeNull();

      expect(await repository.read(tenantA.businessId)).toEqual(beforeA);
      expect(await repository.read(tenantB.businessId)).toEqual(beforeB);
    },
  );

  it.each(["completed", "failed"] as const)(
    "returns null when a business tries to mark another business's job %s",
    async (status) => {
      const tenantA = await createTenant("Tenant A", "only-in-a");
      const tenantB = await createTenant("Tenant B", "only-in-b");
      const jobB = await approve(tenantB);
      const beforeA = await repository.read(tenantA.businessId);
      const beforeB = await repository.read(tenantB.businessId);

      expect(
        await repository.updateExecutionJobStatus(
          tenantA.businessId,
          jobB.id,
          status,
        ),
      ).toBeNull();

      expect(await repository.read(tenantA.businessId)).toEqual(beforeA);
      expect(await repository.read(tenantB.businessId)).toEqual(beforeB);
    },
  );

  it("scopes job updates when two businesses share a job ID", async () => {
    const tenantA = await createTenant("Tenant A", "shared-action-id");
    const tenantB = await createTenant("Tenant B", "shared-action-id");
    const jobA = await approve(tenantA);
    const jobB = await approve(tenantB);
    const sharedJobId = "shared-execution-job-id";

    // Create a deliberate ID collision across businesses in the test fixtures.
    for (const [businessId, jobId] of [
      [tenantA.businessId, jobA.id],
      [tenantB.businessId, jobB.id],
    ]) {
      await getDatabasePool().query(
        "update execution_jobs set id = $3 where business_id = $1 and id = $2",
        [businessId, jobId, sharedJobId],
      );
    }

    const beforeB = await repository.read(tenantB.businessId);
    const updatedA = await repository.updateExecutionJobStatus(
      tenantA.businessId,
      sharedJobId,
      "completed",
    );

    expect(updatedA?.executionJobs).toHaveLength(1);
    expect(updatedA?.executionJobs[0]).toMatchObject({
      id: sharedJobId,
      status: "completed",
      customer: tenantA.action.customer,
    });
    expect(await repository.read(tenantB.businessId)).toEqual(beforeB);
  });

  it("keeps business settings and owner names scoped to one business", async () => {
    const tenantA = await createTenant("Tenant A", "shared-action-id");
    const tenantB = await createTenant("Tenant B", "shared-action-id");
    const beforeB = await repository.read(tenantB.businessId);

    const updatedA = await repository.updateSettings(tenantA.businessId, {
      businessName: "Updated Tenant A Business",
      niche: "Cloud operations",
      ownerName: "Updated Tenant A Owner",
      primaryPainPoint: "overdue_invoices",
    });

    expect(updatedA).toMatchObject({
      businessId: tenantA.businessId,
      businessName: "Updated Tenant A Business",
      niche: "Cloud operations",
      primaryPainPoint: "overdue_invoices",
    });
    expect(updatedA.currentUser.fullName).toBe("Updated Tenant A Owner");
    expect(updatedA.teamMembers).toHaveLength(1);
    expect(updatedA.teamMembers[0].fullName).toBe("Updated Tenant A Owner");
    expect(await repository.read(tenantB.businessId)).toEqual(beforeB);
  });
});
