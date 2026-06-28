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
    delete process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
    delete process.env.CLERK_SECRET_KEY;
    delete process.env.STRIPE_SECRET_KEY;
    delete process.env.STRIPE_WEBHOOK_SECRET;
    delete process.env.STRIPE_PRICE_STARTER;
    delete process.env.STRIPE_PRICE_GROWTH;
    delete process.env.STRIPE_PRICE_PRO;

    const report = getRuntimeConfigReport();

    expect(report.ok).toBe(true);
    expect(report.authMode).toBe("demo");
    expect(report.billingMode).toBe("demo");
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

  it("rejects partial Clerk authentication configuration", () => {
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = "pk_test_example";
    delete process.env.CLERK_SECRET_KEY;

    const report = getRuntimeConfigReport();

    expect(report.ok).toBe(false);
    expect(report.authMode).toBe("demo");
    expect(report.checks).toContainEqual(
      expect.objectContaining({
        key: "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY/CLERK_SECRET_KEY",
        severity: "error",
      }),
    );
  });

  it("reports Clerk mode when both Clerk keys are present", () => {
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = "pk_test_example";
    process.env.CLERK_SECRET_KEY = "sk_test_example";

    const report = getRuntimeConfigReport();

    expect(report.authMode).toBe("clerk");
  });

  it("rejects partial Stripe billing configuration", () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_example";
    delete process.env.STRIPE_WEBHOOK_SECRET;
    delete process.env.STRIPE_PRICE_STARTER;
    delete process.env.STRIPE_PRICE_GROWTH;
    delete process.env.STRIPE_PRICE_PRO;

    const report = getRuntimeConfigReport();

    expect(report.ok).toBe(false);
    expect(report.billingMode).toBe("demo");
    expect(report.checks).toContainEqual(
      expect.objectContaining({
        key: "STRIPE_SECRET_KEY/STRIPE_WEBHOOK_SECRET/STRIPE_PRICE_*",
        severity: "error",
      }),
    );
  });

  it("reports Stripe billing mode when all Stripe variables are present", () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_example";
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_example";
    process.env.STRIPE_PRICE_STARTER = "price_starter";
    process.env.STRIPE_PRICE_GROWTH = "price_growth";
    process.env.STRIPE_PRICE_PRO = "price_pro";

    const report = getRuntimeConfigReport();

    expect(report.billingMode).toBe("stripe");
  });
});
