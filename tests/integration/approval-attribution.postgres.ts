import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { getDatabasePool } from "@/lib/server/database";
import { postgresWorkspaceRepository } from "@/lib/server/postgres-repository";
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

async function createBusiness() {
  const businessId = "test-attribution-" + randomUUID();
  const ownerId = "owner-" + randomUUID();
  const managerId = "manager-" + randomUUID();
  const invitedId = "invited-" + randomUUID();
  const pool = getDatabasePool();
  fixtureBusinesses.push(businessId);

  await pool.query(
    "insert into businesses (id, name, niche) values ($1, $2, $3)",
    [businessId, "Attribution Test Business", "Test operations"],
  );
  // Deliberately use identical display names: only user IDs distinguish actors.
  await pool.query(
    "insert into users (id, business_id, email, full_name, role, status, created_at) values ($1, $2, $3, $4, $5, $6, now() - interval '1 day')",
    [ownerId, businessId, ownerId + "@example.test", "Shared Name", "owner", "active"],
  );
  for (const [id, status] of [[managerId, "active"], [invitedId, "invited"]]) {
    await pool.query(
      "insert into users (id, business_id, email, full_name, role, status) values ($1, $2, $3, $4, $5, $6)",
      [id, businessId, id + "@example.test", "Shared Name", "manager", status],
    );
  }

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
  await postgresWorkspaceRepository.addScan(businessId, {
    actions: [action], revenueLeaks: [],
  });
  return { businessId, ownerId, managerId, invitedId, action };
}

describe("PostgreSQL approval attribution", () => {
  it.each(["approved", "dismissed"] as const)(
    "records a manager's user ID for an %s decision despite identical names",
    async (decision) => {
      const fixture = await createBusiness();
      const result = await postgresWorkspaceRepository.updateActionDecision(
        fixture.businessId, fixture.action.id, decision, { id: fixture.managerId },
      );
      const audit = await getDatabasePool().query<{
        user_id: string; actor_name: string; decision: string;
      }>(
        "select user_id, actor_name, decision from approval_events where business_id = $1 and action_id = $2",
        [fixture.businessId, fixture.action.id],
      );

      expect(audit.rows).toEqual([{
        user_id: fixture.managerId, actor_name: "Shared Name", decision,
      }]);
      expect(result?.approvalEvents[0]).toMatchObject({
        actorId: fixture.managerId, actor: "Shared Name", decision,
      });
      if (decision === "approved") {
        expect(result?.executionJobs).toHaveLength(1);
        expect(result?.executionJobs[0].owner).toBe("Shared Name");
      } else {
        expect(result?.executionJobs).toHaveLength(0);
      }
    },
  );

  it.each(["approved", "dismissed"] as const)(
    "rejects an actor from another business for an %s decision and rolls back",
    async (decision) => {
      const fixture = await createBusiness();
      const other = await createBusiness();
      const before = await postgresWorkspaceRepository.read(fixture.businessId);
      const beforeOther = await postgresWorkspaceRepository.read(other.businessId);

      await expect(postgresWorkspaceRepository.updateActionDecision(
        fixture.businessId, fixture.action.id, decision, { id: other.managerId },
      )).rejects.toThrow("Approval actor must be an active member of this business.");

      expect(await postgresWorkspaceRepository.read(fixture.businessId)).toEqual(before);
      expect(await postgresWorkspaceRepository.read(other.businessId)).toEqual(beforeOther);
    },
  );

  it("rejects an invited actor and rolls back the decision", async () => {
    const fixture = await createBusiness();
    const before = await postgresWorkspaceRepository.read(fixture.businessId);
    await expect(postgresWorkspaceRepository.updateActionDecision(
      fixture.businessId, fixture.action.id, "approved", { id: fixture.invitedId },
    )).rejects.toThrow("Approval actor must be an active member of this business.");
    expect(await postgresWorkspaceRepository.read(fixture.businessId)).toEqual(before);
  });

  it("preserves the original user ID when another member retries an approval", async () => {
    const fixture = await createBusiness();
    const approved = await postgresWorkspaceRepository.updateActionDecision(
      fixture.businessId, fixture.action.id, "approved", { id: fixture.managerId },
    );
    const retried = await postgresWorkspaceRepository.updateActionDecision(
      fixture.businessId, fixture.action.id, "approved", { id: fixture.ownerId },
    );
    expect(retried).toEqual(approved);
    const audit = await getDatabasePool().query<{ user_id: string }>(
      "select user_id from approval_events where business_id = $1 and action_id = $2",
      [fixture.businessId, fixture.action.id],
    );
    expect(audit.rows).toEqual([{ user_id: fixture.managerId }]);
  });
});
