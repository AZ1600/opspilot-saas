import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { getDatabasePool } from "@/lib/server/database";
import { postgresWorkspaceRepository } from "@/lib/server/postgres-repository";
import type { BusinessAction, WorkspaceSnapshot } from "@/lib/types";

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

async function createPendingAction() {
  const businessId = "test-approval-" + randomUUID();
  const userId = "test-owner-" + randomUUID();
  const pool = getDatabasePool();
  fixtureBusinesses.push(businessId);

  await pool.query(
    "insert into businesses (id, name, niche) values ($1, $2, $3)",
    [businessId, "Approval Test Business", "Test operations"],
  );

  await pool.query(
    "insert into users (id, business_id, email, full_name, role, status) values ($1, $2, $3, $4, $5, $6)",
    [userId, businessId, userId + "@example.test", "Test Owner", "owner", "active"],
  );

  const action: BusinessAction = {
    id: "retry-safe-action",
    age: "new",
    customer: "Test Customer",
    draft: "Follow up on the outstanding invoice.",
    priority: "urgent",
    reasonCodes: ["invoice"],
    source: "Gmail",
    status: "pending",
    summary: "An outstanding invoice needs follow-up.",
    title: "Resolve invoice issue",
    value: 100,
  };

  await postgresWorkspaceRepository.addScan(businessId, {
    actions: [action],
    revenueLeaks: [],
  });

  return { businessId, action };
}

async function waitForBlockedApprovals() {
  const deadline = Date.now() + 8_000;

  while (Date.now() < deadline) {
    const result = await getDatabasePool().query<{ count: string }>(
      "select count(*)::text as count from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock' and query ilike '%business_actions%' and pid <> pg_backend_pid()",
    );

    if (Number(result.rows[0].count) >= 2) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  throw new Error("Test setup timed out waiting for two blocked approval requests.");
}

describe("PostgreSQL approval retries", () => {
  it.each(["completed", "failed"] as const)(
    "preserves %s work and approval history",
    async (status) => {
      const { businessId, action } = await createPendingAction();

      const approved = await postgresWorkspaceRepository.updateActionDecision(
        businessId, action.id, "approved", "Test Owner",
      );

      const originalJob = approved?.executionJobs.find((job) => job.actionId === action.id);
      if (!originalJob) {
        throw new Error("Test setup failed: approval created no job.");
      }

      const finished = await postgresWorkspaceRepository.updateExecutionJobStatus(
        businessId, originalJob.id, status,
      );
      const finishedJob = finished?.executionJobs.find((job) => job.id === originalJob.id);
      expect(finishedJob).toMatchObject({ status });

      const retried = await postgresWorkspaceRepository.updateActionDecision(
        businessId, action.id, "approved", "Test Owner",
      );

      expect(retried?.executionJobs.filter((job) => job.actionId === action.id)).toEqual([finishedJob]);
      expect(retried?.approvalEvents.filter((event) => event.actionId === action.id)).toHaveLength(1);
      expect(retried?.impactEntries).toEqual(finished?.impactEntries);
    },
  );

  it("records one approval, impact entry and job for concurrent identical approvals", async () => {
    const { businessId, action } = await createPendingAction();
    const blocker = await getDatabasePool().connect();
    let committed = false;
    let approvals: Promise<PromiseSettledResult<WorkspaceSnapshot | null>[]> | undefined;

    try {
      await blocker.query("begin");
      await blocker.query(
        "select id from business_actions where business_id = $1 and id = $2 for update",
        [businessId, action.id],
      );

      approvals = Promise.allSettled([
        postgresWorkspaceRepository.updateActionDecision(businessId, action.id, "approved", "Test Owner"),
        postgresWorkspaceRepository.updateActionDecision(businessId, action.id, "approved", "Test Owner"),
      ]);

      await waitForBlockedApprovals();
      await blocker.query("commit");
      committed = true;

      const results = await approvals;
      for (const result of results) {
        if (result.status === "rejected") {
          throw result.reason;
        }
        expect(result.value).not.toBeNull();
      }

      const stored = await postgresWorkspaceRepository.read(businessId);
      const jobs = stored.executionJobs.filter((job) => job.actionId === action.id);
      expect(jobs).toHaveLength(1);
      expect(stored.approvalEvents.filter((event) => event.actionId === action.id)).toHaveLength(1);
      expect(stored.impactEntries.filter((entry) => entry.actionId === action.id)).toHaveLength(1);

      for (const result of results) {
        if (result.status === "fulfilled") {
          expect(result.value?.executionJobs.filter((job) => job.actionId === action.id)).toEqual(jobs);
        }
      }
    } finally {
      try {
        if (!committed) {
          await blocker.query("rollback");
        }
      } finally {
        blocker.release();
        if (approvals) {
          await approvals;
        }
      }
    }
  });
});
