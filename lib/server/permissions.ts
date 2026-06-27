import { NextResponse } from "next/server";
import type { RequestSession } from "@/lib/server/auth";
import type { WorkspaceUser } from "@/lib/types";

export type Permission =
  | "actions:approve"
  | "billing:manage"
  | "inbox:scan"
  | "ingestions:create"
  | "settings:manage"
  | "team:manage"
  | "workspace:reset";

const rolePermissions: Record<WorkspaceUser["role"], Permission[]> = {
  owner: [
    "actions:approve",
    "billing:manage",
    "inbox:scan",
    "ingestions:create",
    "settings:manage",
    "team:manage",
    "workspace:reset",
  ],
  manager: ["actions:approve", "inbox:scan", "ingestions:create"],
  staff: [],
};

export function hasPermission(
  session: RequestSession,
  permission: Permission,
) {
  return rolePermissions[session.user.role].includes(permission);
}

export function forbidden(permission: Permission) {
  return NextResponse.json(
    { error: `Missing permission: ${permission}` },
    { status: 403 },
  );
}
