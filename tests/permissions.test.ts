import { describe, expect, it } from "vitest";
import { hasPermission, type Permission } from "@/lib/server/permissions";
import type { RequestSession } from "@/lib/server/auth";
import type { WorkspaceUser } from "@/lib/types";

function sessionFor(role: WorkspaceUser["role"]): RequestSession {
  return {
    businessId: "test-business",
    user: {
      businessId: "test-business",
      email: `${role}@example.com`,
      fullName: `${role} user`,
      id: `user-${role}`,
      role,
    },
  };
}

describe("hasPermission", () => {
  it.each<{
    allowed: Permission[];
    denied: Permission[];
    role: WorkspaceUser["role"];
  }>([
    {
      role: "owner",
      allowed: [
        "actions:approve",
        "billing:manage",
        "inbox:scan",
        "ingestions:create",
        "settings:manage",
        "team:manage",
        "workspace:reset",
      ],
      denied: [],
    },
    {
      role: "manager",
      allowed: ["actions:approve", "inbox:scan", "ingestions:create"],
      denied: ["billing:manage", "settings:manage", "team:manage", "workspace:reset"],
    },
    {
      role: "staff",
      allowed: [],
      denied: ["actions:approve", "inbox:scan", "ingestions:create", "billing:manage"],
    },
  ])("enforces $role permissions", ({ allowed, denied, role }) => {
    const session = sessionFor(role);

    for (const permission of allowed) {
      expect(hasPermission(session, permission)).toBe(true);
    }

    for (const permission of denied) {
      expect(hasPermission(session, permission)).toBe(false);
    }
  });
});
