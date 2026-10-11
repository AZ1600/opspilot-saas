import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { getDatabasePool } from "@/lib/server/database";
import { postgresWorkspaceRepository } from "@/lib/server/postgres-repository";
import { GET as health } from "@/app/api/health/route";
import { authenticatedBusinessId } from "@/lib/server/authenticated-identity";
import type { AuthenticatedIdentity } from "@/lib/server/workspace-repository";

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
  vi.stubEnv("OPSPILOT_REPOSITORY", "postgres");
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", "pk_test_example");
  vi.stubEnv("CLERK_SECRET_KEY", "sk_test_example");
  vi.stubEnv("OPSPILOT_SESSION_SECRET", "test-health-session-secret");
  vi.stubEnv("OPSPILOT_AI_PROVIDER", "rules");
  for (const key of ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_REDIRECT_URI", "STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "STRIPE_PRICE_STARTER", "STRIPE_PRICE_GROWTH", "STRIPE_PRICE_PRO"]) vi.stubEnv(key, "");
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

const tables = ["businesses", "users", "business_actions", "revenue_leaks", "customer_risks", "connected_accounts", "inbox_messages", "ingestions", "knowledge_documents", "timeline_events", "approval_events", "impact_entries", "execution_jobs"];
async function rowCounts() {
  const counts: Record<string, number> = {};
  for (const table of tables) {
    counts[table] = Number((await getDatabasePool().query(`select count(*) from ${table}`)).rows[0].count);
  }
  return counts;
}

describe("read-only PostgreSQL readiness", () => {
  it("checks health without creating a demo business or any workspace rows", async () => {
    const before = await rowCounts();
    const demoBefore = (await getDatabasePool().query("select * from businesses where id = 'business-demo-cleaning'")).rows;
    const response = await health();
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect((await response.json()).dependencies.repository.reachable).toBe(true);
    expect(await rowCounts()).toEqual(before);
    expect((await getDatabasePool().query("select * from businesses where id = 'business-demo-cleaning'")).rows).toEqual(demoBefore);
  });
  it("does not change a customer's account binding, workspace or billing while probing tables", async () => {
    const identity: AuthenticatedIdentity = { provider: "clerk", emailVerified: true,
      providerUserId: "health-fixture-" + randomUUID(), email: randomUUID() + "@example.test", fullName: "Health Test Owner",
    };
    const businessId = authenticatedBusinessId(identity); fixtureBusinesses.push(businessId);
    const session = await postgresWorkspaceRepository.resolveAuthenticatedSession(identity);
    await postgresWorkspaceRepository.updateStripeBilling({ businessId,
      customerId: "test-health-customer-" + randomUUID(), subscriptionId: "test-health-subscription-" + randomUUID(),
      status: "active", planId: "pro",
    });
    const before = await postgresWorkspaceRepository.read(businessId);
    const billing = await postgresWorkspaceRepository.readBillingState(businessId);
    const user = (await getDatabasePool().query("select * from users where id = $1", [session.user.id])).rows;
    const counts = await rowCounts();
    await postgresWorkspaceRepository.checkHealth();
    expect((await health()).status).toBe(200);
    expect(await postgresWorkspaceRepository.read(businessId)).toEqual(before);
    expect(await postgresWorkspaceRepository.readBillingState(businessId)).toEqual(billing);
    expect((await getDatabasePool().query("select * from users where id = $1", [session.user.id])).rows).toEqual(user);
    expect(await rowCounts()).toEqual(counts);
  });
});
