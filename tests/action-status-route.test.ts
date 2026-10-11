import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { requireSession } from "@/lib/server/auth";

const mocks = vi.hoisted(() => ({
  updateActionDecision: vi.fn(),
}));

vi.mock("@/lib/server/auth", () => ({
  requireSession: vi.fn(),
  presentWorkspace: vi.fn((workspace) => workspace),
}));

vi.mock("@/lib/server/repository", () => ({
  getWorkspaceRepository: vi.fn(() => ({
    updateActionDecision: mocks.updateActionDecision,
  })),
}));

import { PATCH } from "@/app/api/actions/[id]/status/route";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.updateActionDecision.mockReset();
  vi.mocked(requireSession).mockReset();
  vi.mocked(requireSession).mockResolvedValue({
    businessId: "test-business",
    user: {
      id: "test-owner",
      businessId: "test-business",
      email: "owner@example.test",
      fullName: "Test Owner",
      role: "owner",
    },
  });
});

function makeRequest(body: string, id = "test-action") {
  return new NextRequest("http://localhost/api/actions/" + id + "/status", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body,
  });
}

describe("action decision request validation", () => {
  it.each([
    { name: "malformed JSON", body: '{"status":', invalidJson: true },
    { name: "JSON null", body: "null", invalidJson: false },
    { name: "an empty body", body: "", invalidJson: true },
    { name: "an array", body: "[]", invalidJson: false },
    { name: "a string", body: '"approved"', invalidJson: false },
    { name: "a number", body: "42", invalidJson: false },
    { name: "a boolean", body: "true", invalidJson: false },
    { name: "a missing status", body: "{}", invalidJson: false },
    { name: "an unsupported status", body: '{"status":"pending"}', invalidJson: false },
    { name: "a non-string status", body: '{"status":null}', invalidJson: false },
  ])("rejects $name without updating an action", async ({ body, invalidJson }) => {
    const response = await PATCH(makeRequest(body), {
      params: Promise.resolve({ id: "test-action" }),
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: invalidJson
        ? "Request body must be valid JSON."
        : "Status must be approved or dismissed.",
    });
    expect(mocks.updateActionDecision).not.toHaveBeenCalled();
  });
});

describe("valid action decisions", () => {
  it.each(["approved", "dismissed"] as const)("updates an action to %s", async (status) => {
    const workspace = {
      businessId: "test-business",
      actions: [{ id: "test-action", status }],
    };
    mocks.updateActionDecision.mockResolvedValueOnce(workspace);

    const response = await PATCH(makeRequest(JSON.stringify({ status })), {
      params: Promise.resolve({ id: "test-action" }),
    });

    expect(response.status).toBe(200);
    expect(mocks.updateActionDecision).toHaveBeenCalledExactlyOnceWith(
      "test-business",
      "test-action",
      status,
      "Test Owner",
    );
    expect(await response.json()).toEqual({ workspace });
  });
});

describe("action decision permissions", () => {
  it("rejects staff before parsing or updating an action", async () => {
    vi.mocked(requireSession).mockResolvedValueOnce({
      businessId: "test-business",
      user: {
        id: "test-staff",
        businessId: "test-business",
        email: "staff@example.test",
        fullName: "Test Staff",
        role: "staff",
      },
    });
    const request = makeRequest('{"status":');
    const parseBody = vi.spyOn(request, "json");

    const response = await PATCH(request, {
      params: Promise.resolve({ id: "test-action" }),
    });

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: "Missing permission: actions:approve",
    });
    expect(parseBody).not.toHaveBeenCalled();
    expect(mocks.updateActionDecision).not.toHaveBeenCalled();
  });
});

describe("missing actions", () => {
  it("returns 404 when the repository finds no matching action", async () => {
    mocks.updateActionDecision.mockResolvedValueOnce(null);

    const response = await PATCH(
      makeRequest(JSON.stringify({ status: "approved" }), "missing-action"),
      { params: Promise.resolve({ id: "missing-action" }) },
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Action not found." });
    expect(mocks.updateActionDecision).toHaveBeenCalledExactlyOnceWith(
      "test-business",
      "missing-action",
      "approved",
      "Test Owner",
    );
  });
});
