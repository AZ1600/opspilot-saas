import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { getDatabasePool } from "@/lib/server/database";
import { postgresWorkspaceRepository } from "@/lib/server/postgres-repository";
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

function identity(email = randomUUID() + "@example.test", providerUserId = "test-auth-" + randomUUID()): AuthenticatedIdentity {
  return { provider: "clerk", providerUserId, emailVerified: true, email, fullName: "Test Auth Owner" };
}
async function resolve(value: AuthenticatedIdentity) {
  const id = authenticatedBusinessId(value);
  if (!fixtureBusinesses.includes(id)) fixtureBusinesses.push(id);
  return postgresWorkspaceRepository.resolveAuthenticatedSession(value);
}
async function member(value: AuthenticatedIdentity, bound: boolean, status = "active") {
  const businessId = "test-auth-legacy-" + randomUUID();
  fixtureBusinesses.push(businessId);
  await getDatabasePool().query("insert into businesses (id, name, niche) values ($1, 'Existing business', 'Test operations')", [businessId]);
  const id = "test-auth-member-" + randomUUID();
  await getDatabasePool().query(
    `insert into users (id, business_id, email, full_name, role, status, auth_provider, auth_user_id)
     values ($1, $2, $3, 'Existing Owner', 'owner', $4, $5, $6)`,
    [id, businessId, value.email.toLowerCase(), status, bound ? value.provider : null, bound ? value.providerUserId : null],
  );
  return { id, businessId };
}
async function stored(id: string) {
  return (await getDatabasePool().query("select * from users where id = $1", [id])).rows[0];
}

describe("PostgreSQL authenticated identity isolation", () => {
  it("refuses an occupied canonical workspace without replacing its existing business", async () => {
    const value = identity(); const id = authenticatedBusinessId(value);
    fixtureBusinesses.push(id);
    await getDatabasePool().query("insert into businesses (id, name, niche) values ($1, 'Protected business', 'Existing niche')", [id]);
    const before = (await getDatabasePool().query("select * from businesses where id = $1", [id])).rows;
    await expect(resolve(value)).rejects.toThrow("cannot be linked");
    expect((await getDatabasePool().query("select * from businesses where id = $1", [id])).rows).toEqual(before);
  });
  it("preserves an existing account's member ID, business and role after its email changes", async () => {
    const original = identity();
    const legacy = await member(original, true);
    await getDatabasePool().query("update users set role = 'manager' where id = $1", [legacy.id]);
    const before = await stored(legacy.id);
    const session = await resolve({ ...original, email: "new-" + original.email });
    expect(session).toMatchObject({ businessId: legacy.businessId, user: { id: legacy.id, role: "manager", fullName: "Existing Owner" } });
    expect(await stored(legacy.id)).toEqual(before);
  });
  it("refuses to replace an already-bound account when a different provider ID uses its email", async () => {
    const original = identity();
    const existing = await member(original, true);
    const before = await stored(existing.id);
    await expect(resolve(identity(original.email))).rejects.toThrow("cannot be linked");
    expect(await stored(existing.id)).toEqual(before);
  });
  it("does not switch a known account to another business when its email matches that business", async () => {
    const first = identity(); const second = identity();
    const a = await member(first, true); const b = await member(second, true);
    const before = await stored(b.id);
    const result = await resolve({ ...first, email: second.email });
    expect(result.businessId).toBe(a.businessId);
    expect(result.user.id).toBe(a.id);
    expect(await stored(b.id)).toEqual(before);
  });
  it.each(["active", "invited"])("links a verified email to an unbound %s member without changing its role or business", async (status) => {
    const value = identity();
    const existing = await member(value, false, status);
    await getDatabasePool().query("update users set role = 'staff' where id = $1", [existing.id]);
    const session = await resolve({ ...value, email: value.email.toUpperCase() });
    expect(session).toMatchObject({ businessId: existing.businessId, user: { id: existing.id, role: "staff" } });
    expect(await stored(existing.id)).toMatchObject({ auth_provider: "clerk", auth_user_id: value.providerUserId, status: "active", invited_at: null });
  });
  it("does not reactivate an invited member that already has a provider binding", async () => {
    const value = identity(); const existing = await member(value, true, "invited");
    const before = await stored(existing.id);
    await expect(resolve(value)).rejects.toThrow("cannot be linked");
    expect(await stored(existing.id)).toEqual(before);
  });
  it("refuses partially bound legacy rows", async () => {
    const value = identity(); const existing = await member(value, false);
    await getDatabasePool().query("update users set auth_provider = 'clerk' where id = $1", [existing.id]);
    const before = await stored(existing.id);
    await expect(resolve(value)).rejects.toThrow("cannot be linked");
    expect(await stored(existing.id)).toEqual(before);
  });
  it("keeps provider IDs that used to share a slug in separate workspaces", async () => {
    const suffix = randomUUID();
    const first = await resolve(identity(undefined, "User_" + suffix));
    const before = await postgresWorkspaceRepository.read(first.businessId);
    const second = await resolve(identity(undefined, "user_" + suffix));
    expect(first.businessId).not.toBe(second.businessId);
    expect(first.user.id).not.toBe(second.user.id);
    expect(await postgresWorkspaceRepository.read(first.businessId)).toEqual(before);
  });
  it("rejects a forged unverified identity before it can claim an invitation", async () => {
    const value = identity(); const existing = await member(value, false, "invited");
    const before = await stored(existing.id);
    await expect(resolve({ ...value, emailVerified: false } as unknown as AuthenticatedIdentity)).rejects.toThrow("cannot be linked");
    expect(await stored(existing.id)).toEqual(before);
  });
  it("returns one owner and workspace for concurrent first sign-ins from one account", async () => {
    const value = identity();
    const results = await Promise.all([resolve(value), resolve(value)]);
    expect(results[0]).toEqual(results[1]);
    const users = await getDatabasePool().query("select id from users where auth_provider = $1 and auth_user_id = $2", [value.provider, value.providerUserId]);
    expect(users.rows).toHaveLength(1);
  });
  it("allows only one account to claim an unbound invitation concurrently", async () => {
    const first = identity(); const existing = await member(first, false, "invited");
    const second = identity(first.email);
    const results = await Promise.allSettled([resolve(first), resolve(second)]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    const user = await stored(existing.id);
    expect(user.business_id).toBe(existing.businessId);
    expect([first.providerUserId, second.providerUserId]).toContain(user.auth_user_id);
  });
  it("rolls back the losing signup when two new accounts concurrently use the same email", async () => {
    const first = identity(); const second = identity(first.email);
    const results = await Promise.allSettled([resolve(first), resolve(second)]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    const users = await getDatabasePool().query("select * from users where lower(email) = $1", [first.email]);
    expect(users.rows).toHaveLength(1);
    const businesses = await getDatabasePool().query("select id from businesses where id = any($1::text[])", [[authenticatedBusinessId(first), authenticatedBusinessId(second)]]);
    expect(businesses.rows).toHaveLength(1);
  });
});
