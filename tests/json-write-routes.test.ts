import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, type NextResponse } from "next/server";
import { demoWorkspace } from "@/lib/demo-data";
import { requireSession } from "@/lib/server/auth";
import { PATCH as updateSettings } from "@/app/api/workspace/settings/route";
import { POST as onboard } from "@/app/api/onboarding/route";
import { POST as invite } from "@/app/api/team/invite/route";
import { POST as ingest } from "@/app/api/ingestions/manual/route";
import { PATCH as updatePlan } from "@/app/api/billing/plan/route";
import { POST as checkout } from "@/app/api/billing/checkout/route";
import { POST as scan } from "@/app/api/inbox/scan/route";
import type { IngestionInsert } from "@/lib/server/workspace-repository";
import type { Permission } from "@/lib/server/permissions";

type InvalidFieldCase = {
  name: string;
  body: Record<string, unknown>;
  error: string;
};
type RouteCase = {
  name: string;
  path: string;
  method: "POST" | "PATCH";
  handler: (request: NextRequest) => Promise<NextResponse>;
  permission: Permission;
  managerAllowed: boolean;
  validBody: Record<string, unknown>;
  invalidFields: InvalidFieldCase[];
};

const mocks = vi.hoisted(() => ({
  getRepository: vi.fn(),
  repository: {
    updateSettings: vi.fn(), onboard: vi.fn(), inviteTeamMember: vi.fn(),
    addIngestion: vi.fn(), updateBillingPlan: vi.fn(), readBillingState: vi.fn(),
    read: vi.fn(), addInboxScan: vi.fn(),
  },
  classify: vi.fn(), configured: vi.fn(), checkout: vi.fn(),
}));

vi.mock("@/lib/server/auth", () => ({
  requireSession: vi.fn(), presentWorkspace: vi.fn((workspace) => workspace),
}));
vi.mock("@/lib/server/repository", () => ({ getWorkspaceRepository: mocks.getRepository }));
vi.mock("@/lib/ai/openai-ingestion", () => ({ classifyManualInputWithProvider: mocks.classify }));
vi.mock("@/lib/server/stripe", () => ({
  isStripeConfigured: mocks.configured, createCheckoutSession: mocks.checkout,
}));

const owner = {
  id: "test-owner", businessId: "test-business", email: "owner@example.test",
  fullName: "Test Owner", role: "owner" as const,
};
const workspace = {
  ...demoWorkspace,
  businessId: owner.businessId,
  currentUser: owner,
  inboxMessages: ["message-a", "message-b"].map((id) => ({
    id, from: id + "@example.test", subject: "Invoice follow-up",
    receivedAt: "Today", preview: "Please resend our invoice.",
    body: "Please resend our overdue invoice payment link.",
    status: "unscanned" as const, estimatedValue: 100,
  })),
};
const classification: IngestionInsert = {
  ingestion: {
    id: "ingestion-test", source: "Manual paste", classifier: "rules",
    rawText: "Please resend our overdue invoice payment link.",
    detectedCategory: "invoice", summary: "Follow up on the invoice.",
    createdAt: "2026-01-01T00:00:00.000Z",
  },
  actions: [{
    id: "classified-action", age: "new", customer: "Test Customer",
    draft: "Resend the payment link.", priority: "urgent", reasonCodes: ["invoice"],
    source: "Gmail", status: "pending", summary: "Invoice follow-up",
    title: "Resolve invoice issue", value: 100,
  }],
  revenueLeaks: [], customerRisks: [],
};
const profile = {
  businessName: " Test Business ", ownerName: " Test Owner ",
  niche: " Cloud operations ", primaryPainPoint: "overdue_invoices",
};
const normalizedProfile = {
  businessName: "Test Business", ownerName: "Test Owner",
  niche: "Cloud operations", primaryPainPoint: "overdue_invoices",
};
const profileCases = [
  { name: "numeric business name", body: { ...profile, businessName: 42 }, error: "Business name is required." },
  { name: "numeric owner name", body: { ...profile, ownerName: 42 }, error: "Owner name is required." },
  { name: "object niche", body: { ...profile, niche: {} }, error: "Industry or niche is required." },
  { name: "blank business name", body: { ...profile, businessName: "   " }, error: "Business name is required." },
  { name: "non-string pain point", body: { ...profile, primaryPainPoint: [] }, error: "Choose a primary operations problem." },
  { name: "unsupported pain point", body: { ...profile, primaryPainPoint: "other" }, error: "Choose a primary operations problem." },
];

const planCases = [
  { name: "numeric plan ID", body: { planId: 42 }, error: "Choose a valid plan." },
  { name: "object plan ID", body: { planId: {} }, error: "Choose a valid plan." },
  { name: "unsupported plan ID", body: { planId: "enterprise" }, error: "Choose a valid plan." },
];

const routes: RouteCase[] = [
  { name: "settings", path: "/api/workspace/settings", method: "PATCH", handler: updateSettings,
    permission: "settings:manage", managerAllowed: false, validBody: profile, invalidFields: profileCases },
  { name: "onboarding", path: "/api/onboarding", method: "POST", handler: onboard,
    permission: "settings:manage", managerAllowed: false, validBody: profile, invalidFields: profileCases },
  { name: "invitations", path: "/api/team/invite", method: "POST", handler: invite,
    permission: "team:manage", managerAllowed: false,
    validBody: { fullName: " Test Manager ", email: " manager@example.test ", role: "manager" },
    invalidFields: [
      { name: "numeric name", body: { fullName: 42, email: "person@example.test", role: "manager" }, error: "Full name is required." },
      { name: "numeric email", body: { fullName: "Test Manager", email: 42, role: "manager" }, error: "Valid email is required." },
      { name: "invalid email", body: { fullName: "Test Manager", email: "invalid", role: "manager" }, error: "Valid email is required." },
      { name: "owner invitation", body: { fullName: "Test Manager", email: "person@example.test", role: "owner" }, error: "Role must be manager or staff." },
      { name: "non-string role", body: { fullName: "Test Manager", email: "person@example.test", role: [] }, error: "Role must be manager or staff." },
    ] },
  { name: "manual ingestion", path: "/api/ingestions/manual", method: "POST", handler: ingest,
    permission: "ingestions:create", managerAllowed: true,
    validBody: { rawText: "  Please resend our overdue invoice payment link.  " },
    invalidFields: [
      { name: "numeric context", body: { rawText: 42 }, error: "Paste at least 20 characters of business context." },
      { name: "object context", body: { rawText: {} }, error: "Paste at least 20 characters of business context." },
      { name: "short context", body: { rawText: "too short" }, error: "Paste at least 20 characters of business context." },
      { name: "blank context", body: { rawText: "                         " }, error: "Paste at least 20 characters of business context." },
    ] },
  { name: "billing plan", path: "/api/billing/plan", method: "PATCH", handler: updatePlan,
    permission: "billing:manage", managerAllowed: false, validBody: { planId: "growth" }, invalidFields: planCases },
  { name: "checkout", path: "/api/billing/checkout", method: "POST", handler: checkout,
    permission: "billing:manage", managerAllowed: false, validBody: { planId: "growth" }, invalidFields: planCases },
  { name: "inbox scan", path: "/api/inbox/scan", method: "POST", handler: scan,
    permission: "inbox:scan", managerAllowed: true, validBody: { messageIds: ["message-a"] },
    invalidFields: [
      { name: "string ID list", body: { messageIds: "prefix-message-a-suffix" }, error: "Select at least one inbox message." },
      { name: "object ID list", body: { messageIds: {} }, error: "Select at least one inbox message." },
      { name: "empty ID list", body: { messageIds: [] }, error: "Select at least one inbox message." },
      { name: "numeric ID", body: { messageIds: [42] }, error: "Message IDs must be non-empty strings." },
      { name: "mixed ID list", body: { messageIds: ["message-a", null] }, error: "Message IDs must be non-empty strings." },
      { name: "blank ID", body: { messageIds: ["   "] }, error: "Message IDs must be non-empty strings." },
    ] },
];

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "test");
  vi.clearAllMocks();
  vi.mocked(requireSession).mockReset().mockResolvedValue({ businessId: owner.businessId, user: owner });
  for (const fn of Object.values(mocks.repository)) { fn.mockReset().mockResolvedValue(workspace); }
  mocks.repository.readBillingState.mockResolvedValue({
    stripeCustomerId: "cus_test", stripeSubscriptionId: null, subscriptionStatus: null,
  });
  mocks.getRepository.mockReset().mockReturnValue(mocks.repository);
  mocks.classify.mockReset().mockImplementation(async (rawText: string, source = "Manual paste") => ({
    ...classification, ingestion: { ...classification.ingestion, rawText, source },
  }));
  mocks.configured.mockReset().mockReturnValue(false);
  mocks.checkout.mockReset().mockResolvedValue({ url: "https://checkout.example.test/session" });
});
afterEach(() => { vi.unstubAllEnvs(); });

function request(route: (typeof routes)[number], body: string) {
  return new NextRequest("http://localhost" + route.path, {
    method: route.method, headers: { "Content-Type": "application/json" }, body,
  });
}

function expectNoDownstreamCalls() {
  expect(mocks.getRepository).not.toHaveBeenCalled();
  for (const fn of Object.values(mocks.repository)) { expect(fn).not.toHaveBeenCalled(); }
  expect(mocks.classify).not.toHaveBeenCalled();
  expect(mocks.configured).not.toHaveBeenCalled();
  expect(mocks.checkout).not.toHaveBeenCalled();
}

describe.each(routes)("$name request boundary", (route) => {
  it.each([
    { name: "malformed JSON", body: "{", error: "Request body must be valid JSON." },
    { name: "empty body", body: "", error: "Request body must be valid JSON." },
    { name: "null", body: "null", error: "Request body must be a JSON object." },
    { name: "an array", body: "[]", error: "Request body must be a JSON object." },
    { name: "a number", body: "42", error: "Request body must be a JSON object." },
  ])("rejects $name before any downstream calls", async ({ body, error }) => {
    const response = await route.handler(request(route, body));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error });
    expectNoDownstreamCalls();
  });

  it.each(route.invalidFields)("rejects $name before any downstream calls", async ({ body, error }) => {
    const response = await route.handler(request(route, JSON.stringify(body)));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error });
    expectNoDownstreamCalls();
  });

  it("keeps valid requests scoped to the session business", async () => {
    const response = await route.handler(request(route, JSON.stringify(route.validBody)));
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.workspace).toEqual(workspace);

    switch (route.name) {
      case "settings":
        expect(mocks.repository.updateSettings).toHaveBeenCalledExactlyOnceWith(owner.businessId, normalizedProfile);
        break;
      case "onboarding":
        expect(mocks.repository.onboard).toHaveBeenCalledExactlyOnceWith(owner.businessId, normalizedProfile, owner);
        break;
      case "invitations":
        expect(mocks.repository.inviteTeamMember).toHaveBeenCalledExactlyOnceWith(owner.businessId, {
          fullName: "Test Manager", email: "manager@example.test", role: "manager",
        });
        break;
      case "manual ingestion":
        expect(mocks.classify).toHaveBeenCalledExactlyOnceWith(classification.ingestion.rawText);
        expect(mocks.repository.addIngestion).toHaveBeenCalledExactlyOnceWith(owner.businessId, classification);
        expect(payload.ingestion).toEqual(classification);
        break;
      case "billing plan":
      case "checkout":
        expect(mocks.repository.updateBillingPlan).toHaveBeenCalledExactlyOnceWith(owner.businessId, "growth");
        if (route.name === "checkout") { expect(payload.mode).toBe("demo"); }
        break;
      case "inbox scan":
        expect(mocks.repository.read).toHaveBeenCalledExactlyOnceWith(owner.businessId);
        expect(mocks.repository.addInboxScan).toHaveBeenCalledExactlyOnceWith(owner.businessId, expect.objectContaining({
          scannedMessageIds: ["message-a"],
        }));
        expect(mocks.classify).toHaveBeenCalledExactlyOnceWith(
          "From: message-a@example.test\nSubject: Invoice follow-up\nPlease resend our overdue invoice payment link.", "Gmail",
        );
        expect(payload.scanned).toBe(1);
        break;
    }
  });

  it("rejects staff before parsing an invalid body", async () => {
    vi.mocked(requireSession).mockResolvedValue({ businessId: owner.businessId, user: { ...owner, role: "staff" } });
    const req = request(route, "{");
    const parse = vi.spyOn(req, "json");
    const response = await route.handler(req);
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "Missing permission: " + route.permission });
    expect(parse).not.toHaveBeenCalled();
    expectNoDownstreamCalls();
  });
});

describe("manager permissions", () => {
  it.each(routes.filter((route) => !route.managerAllowed))("denies managers access to $name before parsing", async (route) => {
    vi.mocked(requireSession).mockResolvedValue({ businessId: owner.businessId, user: { ...owner, role: "manager" } });
    const req = request(route, "{");
    const parse = vi.spyOn(req, "json");
    expect((await route.handler(req)).status).toBe(403);
    expect(parse).not.toHaveBeenCalled();
    expectNoDownstreamCalls();
  });
  it.each(routes.filter((route) => route.managerAllowed))("allows a manager's valid $name request", async (route) => {
    vi.mocked(requireSession).mockResolvedValue({ businessId: owner.businessId, user: { ...owner, role: "manager" } });
    expect((await route.handler(request(route, JSON.stringify(route.validBody)))).status).toBe(200);
  });
});

describe("checkout and inbox success branches", () => {
  it("passes validated checkout data and session identity to Stripe", async () => {
    mocks.configured.mockReturnValue(true);
    vi.stubEnv("STRIPE_PRICE_GROWTH", "price_test_growth");
    const response = await checkout(new NextRequest("http://localhost/api/billing/checkout", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ planId: "growth" }),
    }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ mode: "stripe", url: "https://checkout.example.test/session" });
    expect(mocks.checkout).toHaveBeenCalledExactlyOnceWith({
      businessId: owner.businessId, customerEmail: owner.email, customerId: "cus_test",
      planId: "growth", priceId: "price_test_growth", returnUrl: "http://localhost/",
    });
    expect(mocks.repository.updateBillingPlan).not.toHaveBeenCalled();
  });

  it("returns 400 without creating a checkout when the Stripe price is missing", async () => {
    mocks.configured.mockReturnValue(true);
    vi.stubEnv("STRIPE_PRICE_GROWTH", "");
    const response = await checkout(new NextRequest("http://localhost/api/billing/checkout", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ planId: "growth" }),
    }));
    expect(response.status).toBe(400);
    expect(mocks.checkout).not.toHaveBeenCalled();
    expect(mocks.repository.readBillingState).not.toHaveBeenCalled();
    expect(mocks.repository.updateBillingPlan).not.toHaveBeenCalled();
  });

  it("returns 404 without classification when selected IDs are absent from the business", async () => {
    const response = await scan(new NextRequest("http://localhost/api/inbox/scan", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messageIds: ["foreign-message"] }),
    }));
    expect(response.status).toBe(404);
    expect(mocks.repository.read).toHaveBeenCalledExactlyOnceWith(owner.businessId);
    expect(mocks.classify).not.toHaveBeenCalled();
    expect(mocks.repository.addInboxScan).not.toHaveBeenCalled();
  });

  it("scans multiple messages once each even when IDs are repeated", async () => {
    const response = await scan(new NextRequest("http://localhost/api/inbox/scan", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messageIds: ["message-a", "message-a", "message-b"] }),
    }));
    expect(response.status).toBe(200);
    expect(mocks.classify).toHaveBeenCalledTimes(2);
    expect(mocks.repository.addInboxScan).toHaveBeenCalledExactlyOnceWith(owner.businessId, expect.objectContaining({
      scannedMessageIds: ["message-a", "message-b"],
      actions: [
        { ...classification.actions[0], id: "classified-action-message-a" },
        { ...classification.actions[0], id: "classified-action-message-b" },
      ],
    }));
    expect((await response.json()).scanned).toBe(2);
  });
});
