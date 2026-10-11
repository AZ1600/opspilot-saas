import { AuthIdentityConflictError } from "@/lib/server/authenticated-identity";
import { createHmac, timingSafeEqual } from "node:crypto";
import { currentUser } from "@clerk/nextjs/server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { demoWorkspace } from "@/lib/demo-data";
import { getWorkspaceRepository } from "@/lib/server/repository";
import type { WorkspaceSnapshot, WorkspaceUser } from "@/lib/types";
import { isDemoAuthAllowed } from "@/lib/server/config";

export const sessionCookieName = "opspilot_session";
export type AuthMode = "clerk" | "demo";

export type RequestSession = {
  user: WorkspaceUser;
  businessId: string;
};

export async function requireSession(): Promise<RequestSession> {
  if (isClerkConfigured()) {
    const clerkUser = await currentUser();

    if (!clerkUser) {
      redirect("/login");
    }

    return sessionFromClerkUser(clerkUser);
  }

  if (!isDemoAuthAllowed()) {
    throw new Error("Demo authentication is disabled in production.");
  }

  const cookieSession = await readSessionCookie();

  if (cookieSession) {
    return getWorkspaceRepository().resolveDemoSession(cookieSession.user);
  }

  const role = parseDevRole(process.env.OPSPILOT_DEV_ROLE);
  const defaultName = role === "owner"
    ? demoWorkspace.currentUser.fullName
    : role === "manager" ? "Demo Manager" : "Demo Staff";
  const user: WorkspaceUser = {
    ...demoWorkspace.currentUser,
    id: `user-demo-${role}`,
    email: `${role}@brightops.example`,
    fullName: process.env.OPSPILOT_DEV_USER_NAME?.trim() || defaultName,
    role,
  };

  return getWorkspaceRepository().resolveDemoSession(user);
}

export function getAuthMode(): AuthMode {
  return isClerkConfigured() ? "clerk" : "demo";
}

export function isClerkConfigured() {
  return Boolean(
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY &&
      process.env.CLERK_SECRET_KEY,
  );
}

export function createSessionCookieValue(user: WorkspaceUser) {
  const payload = Buffer.from(
    JSON.stringify({
      businessId: user.businessId,
      email: user.email,
      fullName: user.fullName,
      id: user.id,
      role: user.role,
    }),
  ).toString("base64url");
  const signature = sign(payload);

  return `${payload}.${signature}`;
}

export function presentWorkspace(
  workspace: WorkspaceSnapshot,
  session: RequestSession,
): WorkspaceSnapshot {
  return {
    ...workspace,
    currentUser: {
      ...workspace.currentUser,
      ...session.user,
      businessId: session.businessId,
    },
  };
}

async function readSessionCookie(): Promise<RequestSession | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(sessionCookieName)?.value;

  if (!token) {
    return null;
  }

  const [payload, signature] = token.split(".");

  if (!payload || !signature || !isValidSignature(payload, signature)) {
    return null;
  }

  try {
    const parsed = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    ) as Partial<WorkspaceUser>;

    if (
      !parsed.id ||
      !parsed.businessId ||
      !parsed.email ||
      !parsed.fullName ||
      !isRole(parsed.role)
    ) {
      return null;
    }

    return {
      businessId: parsed.businessId,
      user: {
        id: parsed.id,
        businessId: parsed.businessId,
        email: parsed.email,
        fullName: parsed.fullName,
        role: parsed.role,
      },
    };
  } catch {
    return null;
  }
}

function isValidSignature(payload: string, signature: string) {
  const expected = sign(payload);
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);

  return (
    actualBuffer.length === expectedBuffer.length &&
    timingSafeEqual(actualBuffer, expectedBuffer)
  );
}

function sign(payload: string) {
  return createHmac("sha256", sessionSecret()).update(payload).digest("base64url");
}

function sessionSecret() {
  return process.env.OPSPILOT_SESSION_SECRET ?? "opspilot-local-dev-secret";
}

function parseDevRole(role: string | undefined): WorkspaceUser["role"] {
  if (isRole(role)) {
    return role;
  }

  return "owner";
}

function isRole(role: unknown): role is WorkspaceUser["role"] {
  if (role === "manager" || role === "staff" || role === "owner") {
    return true;
  }

  return false;
}

async function sessionFromClerkUser(
  clerkUser: Awaited<ReturnType<typeof currentUser>>,
): Promise<RequestSession> {
  if (!clerkUser) {
    redirect("/login");
  }

  const primaryEmail = clerkUser.primaryEmailAddress;
  if (primaryEmail?.verification?.status !== "verified" || !primaryEmail.emailAddress?.trim()) {
    redirect("/account?issue=email");
  }
  const email = primaryEmail.emailAddress.trim().toLowerCase();
  const nameFromParts = [clerkUser.firstName, clerkUser.lastName]
    .filter(Boolean)
    .join(" ");
  const fullName = clerkUser.fullName || nameFromParts || email;

  try {
    return await getWorkspaceRepository().resolveAuthenticatedSession({
      provider: "clerk",
      providerUserId: clerkUser.id,
      emailVerified: true,
      email,
      fullName,
    });
  } catch (error) {
    if (error instanceof AuthIdentityConflictError) {
      redirect("/account?issue=workspace");
    }
    throw error;
  }
}
