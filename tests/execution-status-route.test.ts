import { requireSession } from "@/lib/server/auth";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  updateExecutionJobStatus: vi.fn(),
}));

vi.mock("@/lib/server/auth", () => ({
  requireSession: vi.fn().mockResolvedValue({
    businessId: "test-business",
    user: {
      id: "test-owner",
      businessId: "test-business",
      email: "owner@example.com",
      fullName: "Test Owner",
      role: "owner",
    },
  }),
  presentWorkspace: vi.fn((workspace) => workspace),
}));

vi.mock("@/lib/server/repository", () => ({
  getWorkspaceRepository: vi.fn(() => ({
    updateExecutionJobStatus: mocks.updateExecutionJobStatus,
  })),
}));

import { PATCH } from "@/app/api/executions/[id]/status/route";

describe("execution status request validation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([
  { name: "malformed JSON", body: '{"status":' },
  { name: "JSON null", body: "null" },
  { name: "an empty body", body: "" },
  { name: "an array", body: "[]" },
  { name: "a string", body: '"completed"' },
  { name: "a number", body: "42" },
  { name: "a boolean", body: "true" },
  { name: "a missing status", body: "{}" },
  { name: "an unsupported status", body: '{"status":"queued"}' },
  { name: "a non-string status", body: '{"status":null}' },
])("rejects $name without updating a job", async ({ body }) => {
    const request = new NextRequest(
      "http://localhost/api/executions/test-job/status",
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body,
      },
    );

    const response = await PATCH(request, {
      params: Promise.resolve({ id: "test-job" }),
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: expect.any(String),
    });
    expect(mocks.updateExecutionJobStatus).not.toHaveBeenCalled();
  });
});

describe("valid execution status updates", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each(["completed", "failed"] as const)(
    "updates a job to %s",
    async (status) => {
      const workspace = {
        businessId: "test-business",
        executionJobs: [{ id: "test-job", status }],
      };

      mocks.updateExecutionJobStatus.mockResolvedValueOnce(workspace);

      const request = new NextRequest(
        "http://localhost/api/executions/test-job/status",
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status }),
        },
      );

      const response = await PATCH(request, {
        params: Promise.resolve({ id: "test-job" }),
      });

      expect(response.status).toBe(200);

      expect(mocks.updateExecutionJobStatus).toHaveBeenCalledExactlyOnceWith(
        "test-business",
        "test-job",
        status,
      );

      expect(await response.json()).toEqual({ workspace });
    },
  );
});

describe("execution status permissions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects a staff user without updating a job", async () => {
    vi.mocked(requireSession).mockResolvedValueOnce({
      businessId: "test-business",
      user: {
        id: "test-staff",
        businessId: "test-business",
        email: "staff@example.com",
        fullName: "Test Staff",
        role: "staff",
      },
    });

    const request = new NextRequest(
      "http://localhost/api/executions/test-job/status",
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "completed" }),
      },
    );

    const response = await PATCH(request, {
      params: Promise.resolve({ id: "test-job" }),
    });

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: "Missing permission: actions:approve",
    });
    expect(mocks.updateExecutionJobStatus).not.toHaveBeenCalled();
  });
});

describe("missing execution jobs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 404 when the repository finds no matching job", async () => {
    mocks.updateExecutionJobStatus.mockResolvedValueOnce(null);

    const request = new NextRequest(
      "http://localhost/api/executions/missing-job/status",
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "completed" }),
      },
    );

    const response = await PATCH(request, {
      params: Promise.resolve({ id: "missing-job" }),
    });

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: "Execution job not found.",
    });

    expect(mocks.updateExecutionJobStatus).toHaveBeenCalledExactlyOnceWith(
      "test-business",
      "missing-job",
      "completed",
    );
  });
});