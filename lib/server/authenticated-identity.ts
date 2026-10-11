import { createHash } from "node:crypto";
import type { AuthenticatedIdentity } from "@/lib/server/workspace-repository";

export class AuthIdentityConflictError extends Error {
  constructor() {
    super("This account cannot be linked to the workspace.");
    this.name = "AuthIdentityConflictError";
  }
}

export function assertAuthenticatedIdentity(identity: AuthenticatedIdentity) {
  if (
    identity.provider !== "clerk" || identity.emailVerified !== true ||
    !identity.providerUserId?.trim() || !identity.email?.trim() ||
    !identity.email.includes("@") || !identity.fullName?.trim()
  ) {
    throw new AuthIdentityConflictError();
  }
}

export function authenticatedBusinessId(identity: AuthenticatedIdentity) {
  const digest = createHash("sha256")
    .update(JSON.stringify([identity.provider, identity.providerUserId]))
    .digest("hex");
  return `business-${digest}`;
}
