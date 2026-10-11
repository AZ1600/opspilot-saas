import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";
import { NextRequest } from "next/server";
import { POST as webhook } from "@/app/api/billing/webhook/route";

const mocks = vi.hoisted(() => ({
  getRepository: vi.fn(), updateBilling: vi.fn(), updateByCustomer: vi.fn(),
}));
vi.mock("@/lib/server/repository", () => ({ getWorkspaceRepository: mocks.getRepository }));

const secret = "whsec_test_webhook_signatures";
const now = Math.floor(Date.UTC(2026, 9, 11, 12, 0, 0) / 1000);
const event = {
  id: "evt_test_checkout", type: "checkout.session.completed", created: now - 86_400,
  data: { object: {
    id: "cs_test", customer: "cus_test", subscription: "sub_test", status: "complete",
    metadata: { businessId: "test-business", planId: "growth" },
  } },
};
const payload = JSON.stringify(event);

beforeEach(() => {
  vi.stubEnv("STRIPE_WEBHOOK_SECRET", secret);
  vi.stubEnv("STRIPE_PRICE_GROWTH", "price_test_growth");
  vi.spyOn(Date, "now").mockReturnValue(now * 1000);
  mocks.updateBilling.mockReset().mockResolvedValue(undefined);
  mocks.updateByCustomer.mockReset().mockResolvedValue(undefined);
  mocks.getRepository.mockReset().mockReturnValue({
    updateStripeBilling: mocks.updateBilling,
    updateStripeBillingByCustomer: mocks.updateByCustomer,
  });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

function signature(timestamp: number | string, body = payload, key = secret) {
  const digest = createHmac("sha256", key).update(String(timestamp) + "." + body).digest("hex");
  return `t=${timestamp},v1=${digest}`;
}

async function send(body: string, header: string | null) {
  return webhook(new NextRequest("https://app.example.test/api/billing/webhook", {
    method: "POST", headers: {
      "Content-Type": "application/json",
      ...(header === null ? {} : { "stripe-signature": header }),
    }, body,
  }));
}

function expectNoMutation() {
  expect(mocks.getRepository).not.toHaveBeenCalled();
  expect(mocks.updateBilling).not.toHaveBeenCalled();
  expect(mocks.updateByCustomer).not.toHaveBeenCalled();
}

describe("Stripe webhook signature boundary", () => {
  it("accepts a fresh delivery of an older event and records its billing data", async () => {
    const response = await send(payload, signature(now));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true });
    expect(mocks.updateBilling).toHaveBeenCalledExactlyOnceWith({
      businessId: "test-business", customerId: "cus_test", planId: "growth",
      status: "complete", subscriptionId: "sub_test",
    });
  });

  it.each([-300, 300])("accepts a correctly signed timestamp at the %s second boundary", async (offset) => {
    expect((await send(payload, signature(now + offset))).status).toBe(200);
    expect(mocks.updateBilling).toHaveBeenCalledTimes(1);
  });

  it.each([-301, 301])("rejects a correctly signed timestamp outside the window at %s seconds", async (offset) => {
    const response = await send(payload, signature(now + offset));
    expect(response.status).toBe(400);
    expectNoMutation();
  });

  it.each(["not-a-number", "1e9", "-1", "1.5", "99999999999999999999"])(
    "rejects a correctly signed malformed timestamp: %s", async (timestamp) => {
      expect((await send(payload, signature(timestamp))).status).toBe(400);
      expectNoMutation();
    },
  );

  it("rejects a missing signature", async () => {
    expect((await send(payload, null)).status).toBe(400);
    expectNoMutation();
  });

  it("rejects a wrong signing secret", async () => {
    expect((await send(payload, signature(now, payload, "wrong_secret"))).status).toBe(400);
    expectNoMutation();
  });

  it("rejects a tampered raw payload", async () => {
    expect((await send(payload.replace("growth", "pro"), signature(now))).status).toBe(400);
    expectNoMutation();
  });

  it("rejects a v0-only signature", async () => {
    expect((await send(payload, signature(now).replace("v1=", "v0="))).status).toBe(400);
    expectNoMutation();
  });

  it("accepts one matching v1 signature among multiple signatures", async () => {
    const header = signature(now).replace(",v1=", ", v1=invalid, v1=");
    expect((await send(payload, header)).status).toBe(200);
    expect(mocks.updateBilling).toHaveBeenCalledTimes(1);
  });

  it("rejects a missing timestamp", async () => {
    const header = signature(now).split(",")[1];
    expect((await send(payload, header)).status).toBe(400);
    expectNoMutation();
  });

  it("rejects a signed malformed JSON body without mutating billing", async () => {
    expect((await send("{", signature(now, "{"))).status).toBe(400);
    expectNoMutation();
  });

  it("verifies the original raw body including Unicode and whitespace", async () => {
    const raw = " \n" + JSON.stringify({ ...event, description: "Café invoice" }) + "\n";
    expect((await send(raw, signature(now, raw))).status).toBe(200);
    expect(mocks.updateBilling).toHaveBeenCalledTimes(1);
  });

  it("rejects a request when the webhook secret is missing", async () => {
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "");
    expect((await send(payload, signature(now))).status).toBe(400);
    expectNoMutation();
  });

  it("routes a signed subscription update through its customer ID", async () => {
    const raw = JSON.stringify({
      id: "evt_test_subscription", type: "customer.subscription.updated",
      data: { object: {
        id: "sub_test", customer: "cus_test", status: "active",
        items: { data: [{ price: { id: "price_test_growth" } }] },
      } },
    });
    expect((await send(raw, signature(now, raw))).status).toBe(200);
    expect(mocks.updateByCustomer).toHaveBeenCalledExactlyOnceWith({
      customerId: "cus_test", planId: "growth", status: "active", subscriptionId: "sub_test",
    });
    expect(mocks.updateBilling).not.toHaveBeenCalled();
  });
});
