import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, type NextFetchEvent } from "next/server";
import { getWorkspaceRepository } from "@/lib/server/repository";
import { getRuntimeConfigReport } from "@/lib/server/config";
import { GET as health } from "@/app/api/health/route";
import proxy from "@/proxy";

const mocks = vi.hoisted(() => ({
  file: { checkHealth: vi.fn(), read: vi.fn() },
  postgres: { checkHealth: vi.fn(), read: vi.fn() },
  clerk: vi.fn(() => new Response(null, { status: 200 })),
}));
vi.mock("@/lib/server/workspace-store", () => ({ fileWorkspaceRepository: mocks.file }));
vi.mock("@/lib/server/postgres-repository", () => ({ postgresWorkspaceRepository: mocks.postgres }));
vi.mock("@clerk/nextjs/server", () => ({ clerkMiddleware: () => mocks.clerk }));
beforeEach(() => {
  vi.clearAllMocks();
  mocks.file.checkHealth.mockReset().mockResolvedValue(undefined);
  mocks.postgres.checkHealth.mockReset().mockResolvedValue(undefined);
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("OPSPILOT_REPOSITORY", "postgres");
  vi.stubEnv("DATABASE_URL", "postgresql://test_user:dummy_password@db.example.test/opspilot");
  vi.stubEnv("OPSPILOT_SESSION_SECRET", "test-session-secret");
  vi.stubEnv("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", "pk_test_example");
  vi.stubEnv("CLERK_SECRET_KEY", "sk_test_example");
  vi.stubEnv("OPSPILOT_AI_PROVIDER", "rules");
  for (const key of ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_REDIRECT_URI", "STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "STRIPE_PRICE_STARTER", "STRIPE_PRICE_GROWTH", "STRIPE_PRICE_PRO"]) vi.stubEnv(key, "");
});
afterEach(() => { vi.unstubAllEnvs(); });

describe("production repository selection", () => {
  it.each([undefined, "file", "unknown"])("refuses production file fallback for mode %s", (mode) => {
    vi.stubEnv("OPSPILOT_REPOSITORY", mode);
    expect(() => getWorkspaceRepository()).toThrow();
    expect(mocks.file.read).not.toHaveBeenCalled();
  });
  it("rejects production postgres without a database URL", () => {
    vi.stubEnv("DATABASE_URL", "");
    expect(() => getWorkspaceRepository()).toThrow();
  });
  it.each(["not-a-url", "https://db.example.test/opspilot", "postgresql://db.example.test", "postgresql:///opspilot", " "])(
    "rejects an incomplete or unsupported database URL: %s", (value) => {
      vi.stubEnv("DATABASE_URL", value);
      expect(() => getWorkspaceRepository()).toThrow();
    },
  );
  it.each(["postgres", "postgresql"])("selects production PostgreSQL using %s URLs", (protocol) => {
    vi.stubEnv("DATABASE_URL", `${protocol}://test_user:dummy_password@db.example.test/opspilot`);
    expect(getWorkspaceRepository()).toBe(mocks.postgres);
  });
  it.each(["development", "test"])("keeps the default local file repository in %s", (environment) => {
    vi.stubEnv("NODE_ENV", environment); vi.stubEnv("OPSPILOT_REPOSITORY", undefined);
    expect(getWorkspaceRepository()).toBe(mocks.file);
  });
  it("refuses an unknown selector outside production instead of silently choosing files", () => {
    vi.stubEnv("NODE_ENV", "development"); vi.stubEnv("OPSPILOT_REPOSITORY", "postgre");
    expect(() => getWorkspaceRepository()).toThrow();
  });
  it("reports production file storage as an error", () => {
    vi.stubEnv("OPSPILOT_REPOSITORY", "file");
    const report = getRuntimeConfigReport();
    expect(report.ok).toBe(false);
    expect(report.checks).toContainEqual(expect.objectContaining({ key: "OPSPILOT_REPOSITORY", severity: "error" }));
  });
  it("reports malformed URLs without exposing their credentials", () => {
    vi.stubEnv("DATABASE_URL", "https://private_user:private_password@db.example.test/opspilot");
    const report = getRuntimeConfigReport();
    expect(report.ok).toBe(false);
    expect(JSON.stringify(report)).not.toContain("private_password");
    expect(() => getWorkspaceRepository()).toThrow("PostgreSQL connection URL");
  });
});

describe("read-only health route", () => {
  it("uses the PostgreSQL health probe without reading or seeding a workspace", async () => {
    const response = await health();
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(mocks.postgres.checkHealth).toHaveBeenCalledOnce();
    expect(mocks.postgres.read).not.toHaveBeenCalled();
  });
  it("uses the file directory probe for a local development health request", async () => {
    vi.stubEnv("NODE_ENV", "development"); vi.stubEnv("OPSPILOT_REPOSITORY", "file");
    expect((await health()).status).toBe(200);
    expect(mocks.file.checkHealth).toHaveBeenCalledOnce();
    expect(mocks.file.read).not.toHaveBeenCalled();
  });
  it("refuses production file storage without touching it", async () => {
    vi.stubEnv("OPSPILOT_REPOSITORY", "file");
    const response = await health();
    expect(response.status).toBe(503);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect((await response.json()).dependencies.repository.reachable).toBe(false);
    expect(mocks.file.checkHealth).not.toHaveBeenCalled();
    expect(mocks.file.read).not.toHaveBeenCalled();
  });
  it("returns 503 for a failed database probe without exposing database errors or secrets", async () => {
    mocks.postgres.checkHealth.mockRejectedValue(new Error("Database failure with private_password"));
    const response = await health();
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.dependencies.repository.reachable).toBe(false);
    expect(JSON.stringify(body)).not.toContain("private_password");
    expect(mocks.postgres.read).not.toHaveBeenCalled();
  });
});

describe("workspace request configuration guard", () => {
  async function request(path: string) {
    return await proxy(new NextRequest("https://opspilot.example" + path), {} as NextFetchEvent) as Response;
  }
  it.each(["/app", "/app/settings", "/api/workspace", "/api/ingestions/manual"])(
    "returns 503 for %s before workspace handling when production storage is invalid", async (path) => {
      vi.stubEnv("OPSPILOT_REPOSITORY", "file");
      const response = await request(path);
      expect(response.status).toBe(503);
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      expect(mocks.clerk).not.toHaveBeenCalled();
    },
  );
  it("passes a configured PostgreSQL workspace request to Clerk", async () => {
    expect((await request("/app")).status).toBe(200);
    expect(mocks.clerk).toHaveBeenCalledOnce();
  });
  it.each(["/", "/demo", "/account", "/api/auth/logout", "/api/health"])(
    "keeps %s available through the existing authentication middleware for configuration diagnosis or account access", async (path) => {
      vi.stubEnv("OPSPILOT_REPOSITORY", "file");
      expect((await request(path)).status).toBe(200);
      expect(mocks.clerk).toHaveBeenCalledOnce();
    },
  );
  it("preserves local file-mode workspace access", async () => {
    vi.stubEnv("NODE_ENV", "development"); vi.stubEnv("OPSPILOT_REPOSITORY", "file");
    expect((await request("/app")).status).toBe(200);
    expect(mocks.clerk).toHaveBeenCalledOnce();
  });
});
