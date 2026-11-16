import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  requireSession: vi.fn(),
  validateOAuthState: vi.fn(),
  exchangeGmailOAuthCode: vi.fn(),
  storeGmailToken: vi.fn(),
  createRealGmailAccount: vi.fn(),
  upsertConnectedAccount: vi.fn(),
  getWorkspaceRepository: vi.fn(),
}));

vi.mock("@/lib/server/auth", () => ({
  requireSession: mocks.requireSession,
}));
vi.mock("@/lib/connectors/gmail", () => ({
  validateOAuthState: mocks.validateOAuthState,
  exchangeGmailOAuthCode: mocks.exchangeGmailOAuthCode,
  storeGmailToken: mocks.storeGmailToken,
  createRealGmailAccount: mocks.createRealGmailAccount,
}));
vi.mock("@/lib/server/repository", () => ({
  getWorkspaceRepository: mocks.getWorkspaceRepository,
}));

import { GET } from "@/app/api/connectors/gmail/callback/route";

const businessId = "business-a";
const token = { access_token: "access-token", refresh_token: "refresh-token" };
const account = { id: "gmail-primary", provider: "Gmail", status: "connected" };

function request(query = "code=valid-code&state=signed-state") {
  return new NextRequest(
    `https://app.example.test/api/connectors/gmail/callback?${query}`,
  );
}

function setRole(role: "owner" | "manager" | "staff") {
  mocks.requireSession.mockResolvedValue({
    businessId,
    user: {
      id: `user-${role}`,
      businessId,
      email: `${role}@example.test`,
      fullName: `${role} user`,
      role,
    },
  });
}

function expectNoOAuthSideEffects() {
  expect(mocks.validateOAuthState).not.toHaveBeenCalled();
  expect(mocks.exchangeGmailOAuthCode).not.toHaveBeenCalled();
  expect(mocks.storeGmailToken).not.toHaveBeenCalled();
  expect(mocks.getWorkspaceRepository).not.toHaveBeenCalled();
  expect(mocks.upsertConnectedAccount).not.toHaveBeenCalled();
}

beforeEach(() => {
  vi.resetAllMocks();
  setRole("owner");
  mocks.validateOAuthState.mockReturnValue(true);
  mocks.exchangeGmailOAuthCode.mockResolvedValue(token);
  mocks.storeGmailToken.mockResolvedValue(undefined);
  mocks.createRealGmailAccount.mockReturnValue(account);
  mocks.upsertConnectedAccount.mockResolvedValue(undefined);
  mocks.getWorkspaceRepository.mockReturnValue({
    upsertConnectedAccount: mocks.upsertConnectedAccount,
  });
});

describe("Gmail OAuth callback authorization", () => {
  it.each(["manager", "staff"] as const)(
    "rejects a %s even with a previously signed OAuth state",
    async (role) => {
      setRole(role);
      const response = await GET(request());
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({
        error: "Missing permission: settings:manage",
      });
      expectNoOAuthSideEffects();
    },
  );

  it("rejects a downgraded manager before processing Google errors", async () => {
    setRole("manager");
    const response = await GET(request("error=access_denied"));
    expect(response.status).toBe(403);
    expectNoOAuthSideEffects();
  });

  it("allows the authorized owner to finish a workspace-bound OAuth callback", async () => {
    const response = await GET(request());
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      "https://app.example.test/?view=settings&gmail=connected",
    );
    expect(mocks.validateOAuthState).toHaveBeenCalledExactlyOnceWith(
      "signed-state", businessId,
    );
    expect(mocks.exchangeGmailOAuthCode).toHaveBeenCalledExactlyOnceWith(
      "valid-code",
    );
    expect(mocks.storeGmailToken).toHaveBeenCalledExactlyOnceWith(
      businessId, token,
    );
    expect(mocks.createRealGmailAccount).toHaveBeenCalledExactlyOnceWith(token);
    expect(mocks.upsertConnectedAccount).toHaveBeenCalledExactlyOnceWith(
      businessId, account,
    );
  });

  it("rejects an invalid workspace-bound state before token exchange", async () => {
    mocks.validateOAuthState.mockReturnValue(false);
    const response = await GET(request());
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      "https://app.example.test/?view=settings&gmail_error=invalid_oauth_state",
    );
    expect(mocks.validateOAuthState).toHaveBeenCalledExactlyOnceWith(
      "signed-state", businessId,
    );
    expect(mocks.exchangeGmailOAuthCode).not.toHaveBeenCalled();
    expect(mocks.storeGmailToken).not.toHaveBeenCalled();
    expect(mocks.getWorkspaceRepository).not.toHaveBeenCalled();
  });

  it("preserves the provider-error redirect for an authorized owner", async () => {
    const response = await GET(request("error=access_denied"));
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      "https://app.example.test/?view=settings&gmail_error=access_denied",
    );
    expectNoOAuthSideEffects();
  });
});
