import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { requireSession } from "@/lib/server/auth";
import { PATCH as changePlan } from "@/app/api/billing/plan/route";
import { POST as checkout } from "@/app/api/billing/checkout/route";

const mocks = vi.hoisted(() => ({
  getRepository: vi.fn(), updatePlan: vi.fn(), readBilling: vi.fn(),
  configured: vi.fn(), checkout: vi.fn(),
}));

vi.mock("@/lib/server/auth", () => ({
  requireSession: vi.fn(), presentWorkspace: (workspace: unknown) => workspace,
}));
vi.mock("@/lib/server/repository", () => ({ getWorkspaceRepository: mocks.getRepository }));
vi.mock("@/lib/server/stripe", () => ({
  isStripeConfigured: mocks.configured, createCheckoutSession: mocks.checkout,
}));

const owner = {
  id: "billing-owner", businessId: "billing-business", email: "owner@example.test",
  fullName: "Billing Owner", role: "owner" as const,
};
const workspace = { businessId: owner.businessId, billingPlan: { id: "pro" } };

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("STRIPE_WEBHOOK_SECRET", "whsec_test_billing_guard");
  vi.stubEnv("STRIPE_PRICE_PRO", "price_test_pro");
  vi.mocked(requireSession).mockReset().mockResolvedValue({ businessId: owner.businessId, user: owner });
  mocks.updatePlan.mockReset().mockResolvedValue(workspace);
  mocks.readBilling.mockReset().mockResolvedValue({ stripeCustomerId: "cus_test" });
  mocks.getRepository.mockReset().mockReturnValue({
    updateBillingPlan: mocks.updatePlan, readBillingState: mocks.readBilling,
  });
  mocks.configured.mockReset().mockReturnValue(true);
  mocks.checkout.mockReset().mockResolvedValue({ url: "https://checkout.example.test/session" });
});
afterEach(() => { vi.unstubAllEnvs(); });

function request(path: string, method: string) {
  return new NextRequest("https://app.example.test" + path, {
    method, headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ planId: "pro" }),
  });
}

function expectNoBillingChanges() {
  expect(mocks.getRepository).not.toHaveBeenCalled();
  expect(mocks.updatePlan).not.toHaveBeenCalled();
  expect(mocks.readBilling).not.toHaveBeenCalled();
  expect(mocks.checkout).not.toHaveBeenCalled();
}

describe("production billing boundaries", () => {
  it.each([false, true])("blocks direct production plan updates with Stripe configured=%s", async (configured) => {
    mocks.configured.mockReturnValue(configured);
    const response = await changePlan(request("/api/billing/plan", "PATCH"));
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "Use Stripe checkout to change billing plans." });
    expectNoBillingChanges();
  });

  it("blocks direct plan changes in development when Stripe is enabled", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const response = await changePlan(request("/api/billing/plan", "PATCH"));
    expect(response.status).toBe(403);
    expectNoBillingChanges();
  });

  it("preserves local demo plan selection without Stripe", async () => {
    vi.stubEnv("NODE_ENV", "development");
    mocks.configured.mockReturnValue(false);
    const response = await changePlan(request("/api/billing/plan", "PATCH"));
    expect(response.status).toBe(200);
    expect(mocks.updatePlan).toHaveBeenCalledExactlyOnceWith(owner.businessId, "pro");
  });

  it.each(["Stripe key", "webhook secret", "plan price"])(
    "returns 503 without granting a plan when production lacks the %s", async (missing) => {
      if (missing === "Stripe key") { mocks.configured.mockReturnValue(false); }
      if (missing === "webhook secret") { vi.stubEnv("STRIPE_WEBHOOK_SECRET", ""); }
      if (missing === "plan price") { vi.stubEnv("STRIPE_PRICE_PRO", ""); }
      const response = await checkout(request("/api/billing/checkout", "POST"));
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({
        error: "Billing is temporarily unavailable. Please try again later.",
      });
      expectNoBillingChanges();
    },
  );

  it("starts configured production checkout without changing the stored plan", async () => {
    const response = await checkout(request("/api/billing/checkout", "POST"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ mode: "stripe", url: "https://checkout.example.test/session" });
    expect(mocks.checkout).toHaveBeenCalledExactlyOnceWith({
      businessId: owner.businessId, customerEmail: owner.email, customerId: "cus_test",
      planId: "pro", priceId: "price_test_pro", returnUrl: "https://app.example.test/",
    });
    expect(mocks.updatePlan).not.toHaveBeenCalled();
  });

  it("preserves development demo checkout without Stripe", async () => {
    vi.stubEnv("NODE_ENV", "development");
    mocks.configured.mockReturnValue(false);
    const response = await checkout(request("/api/billing/checkout", "POST"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ mode: "demo", workspace });
    expect(mocks.updatePlan).toHaveBeenCalledExactlyOnceWith(owner.businessId, "pro");
    expect(mocks.checkout).not.toHaveBeenCalled();
  });
});
