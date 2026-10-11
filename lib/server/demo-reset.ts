import { demoWorkspace } from "@/lib/demo-data";
import { isDemoAuthAllowed } from "@/lib/server/config";
import type { RequestSession } from "@/lib/server/auth";

export function canResetDemoWorkspace(session: RequestSession) {
  return isDemoAuthAllowed() &&
    !process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY &&
    !process.env.CLERK_SECRET_KEY &&
    session.businessId === demoWorkspace.businessId &&
    session.user.businessId === demoWorkspace.businessId &&
    session.user.id === demoWorkspace.currentUser.id &&
    session.user.role === "owner";
}
