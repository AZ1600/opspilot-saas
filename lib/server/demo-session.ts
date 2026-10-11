import { demoWorkspace } from "@/lib/demo-data";
import { isDemoAuthAllowed } from "@/lib/server/config";
import type { WorkspaceUser } from "@/lib/types";

export function assertDemoSessionUser(user: WorkspaceUser) {
  if (!isDemoAuthAllowed()) {
    throw new Error("Demo authentication is disabled in production.");
  }

  if (
    !["owner", "manager", "staff"].includes(user.role) ||
    user.businessId !== demoWorkspace.businessId ||
    user.id !== `user-demo-${user.role}` ||
    user.email !== `${user.role}@brightops.example` ||
    typeof user.fullName !== "string" ||
    user.fullName.trim().length === 0
  ) {
    throw new Error("Invalid demo session identity.");
  }
}
