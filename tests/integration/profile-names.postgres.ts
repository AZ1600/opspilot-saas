import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { getDatabasePool } from "@/lib/server/database";
import { postgresWorkspaceRepository } from "@/lib/server/postgres-repository";
import type { WorkspaceUser } from "@/lib/types";
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

const owner: WorkspaceUser = {
  ...demoWorkspace.currentUser, fullName: "Initial Login Owner",
};
const profile = {
  businessName: "Saved PostgreSQL Business", niche: "Cleaning services",
  ownerName: "Saved PostgreSQL Owner", primaryPainPoint: "missed_leads" as const,
};

describe("PostgreSQL profile name persistence", () => {
  it("preserves a saved owner name when an older cookie resolves the next session", async () => {
    await postgresWorkspaceRepository.resolveDemoSession(owner, { updateName: true });
    await postgresWorkspaceRepository.updateSettings(owner.businessId, profile);
    const session = await postgresWorkspaceRepository.resolveDemoSession(owner);
    expect(session.user.fullName).toBe(profile.ownerName);
    const workspace = await postgresWorkspaceRepository.read(owner.businessId);
    expect(workspace.currentUser.fullName).toBe(profile.ownerName);
    expect(workspace.teamMembers.find((member) => member.id === owner.id)?.fullName).toBe(profile.ownerName);
  });
  it("preserves the onboarding name across repeated demo session resolution", async () => {
    await postgresWorkspaceRepository.resolveDemoSession(owner, { updateName: true });
    await postgresWorkspaceRepository.onboard(owner.businessId, profile, owner);
    expect((await postgresWorkspaceRepository.resolveDemoSession(owner)).user.fullName).toBe(profile.ownerName);
    expect((await postgresWorkspaceRepository.resolveDemoSession(owner)).user.fullName).toBe(profile.ownerName);
  });
  it("allows an explicit login name change while leaving the business settings intact", async () => {
    await postgresWorkspaceRepository.resolveDemoSession(owner, { updateName: true });
    await postgresWorkspaceRepository.updateSettings(owner.businessId, profile);
    const updated = await postgresWorkspaceRepository.resolveDemoSession({ ...owner, fullName: "Fresh Login Name" }, { updateName: true });
    expect(updated.user.fullName).toBe("Fresh Login Name");
    expect((await postgresWorkspaceRepository.read(owner.businessId)).businessName).toBe(profile.businessName);
  });
  it("preserves a manager's stored name while resolving an older cookie", async () => {
    await postgresWorkspaceRepository.resolveDemoSession(manager);
    await getDatabasePool().query("update users set full_name = 'Stored Manager Name' where id = $1", [manager.id]);
    const session = await postgresWorkspaceRepository.resolveDemoSession(manager);
    expect(session.user.fullName).toBe("Stored Manager Name");
    expect(session.user.role).toBe("manager");
  });
  it("does not permit demo login to change a partially bound provider member", async () => {
    await postgresWorkspaceRepository.resolveDemoSession(manager);
    await getDatabasePool().query("update users set auth_user_id = 'protected-provider-id' where id = $1", [manager.id]);
    const before = (await getDatabasePool().query("select * from users where id = $1", [manager.id])).rows;
    await expect(postgresWorkspaceRepository.resolveDemoSession({ ...manager, fullName: "Replacement Name" }, { updateName: true }))
      .rejects.toThrow("Demo identity conflicts with an existing user.");
    expect((await getDatabasePool().query("select * from users where id = $1", [manager.id])).rows).toEqual(before);
  });
});
