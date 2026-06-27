import { afterEach, describe, expect, it } from "vitest";
import { getRuntimeConfigReport } from "@/lib/server/config";

const originalEnv = { ...process.env };

function restoreEnv() {
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnv)) {
      delete process.env[key];
    }
  }

  Object.assign(process.env, originalEnv);
}

afterEach(() => {
  restoreEnv();
});

describe("getRuntimeConfigReport", () => {
  it("accepts the local file and rules defaults", () => {
    delete process.env.OPSPILOT_REPOSITORY;
    delete process.env.OPSPILOT_AI_PROVIDER;
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
    delete process.env.GOOGLE_REDIRECT_URI;

    const report = getRuntimeConfigReport();

    expect(report.ok).toBe(true);
    expect(report.repository).toBe("file");
    expect(report.aiProvider).toBe("rules");
    expect(report.gmailMode).toBe("mock");
  });

  it("requires a database URL when postgres storage is selected", () => {
    process.env.OPSPILOT_REPOSITORY = "postgres";
    delete process.env.DATABASE_URL;

    const report = getRuntimeConfigReport();

    expect(report.ok).toBe(false);
    expect(report.checks).toContainEqual(
      expect.objectContaining({
        key: "DATABASE_URL",
        severity: "error",
      }),
    );
  });

  it("rejects partial Google OAuth configuration", () => {
    process.env.GOOGLE_CLIENT_ID = "client-id";
    delete process.env.GOOGLE_CLIENT_SECRET;
    delete process.env.GOOGLE_REDIRECT_URI;

    const report = getRuntimeConfigReport();

    expect(report.ok).toBe(false);
    expect(report.gmailMode).toBe("mock");
    expect(report.checks).toContainEqual(
      expect.objectContaining({
        key: "GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET/GOOGLE_REDIRECT_URI",
        severity: "error",
      }),
    );
  });
});
