import { createHmac, timingSafeEqual } from "node:crypto";
import { currentUser } from "@clerk/nextjs/server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { demoWorkspace } from "@/lib/demo-data";
import { getWorkspaceRepository } from "@/lib/server/repository";
import type { WorkspaceSnapshot, WorkspaceUser } from "@/lib/types";

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

  const cookieSession = await readSessionCookie();

  if (cookieSession) {
    return cookieSession;
  }

  const user: WorkspaceUser = {
    ...demoWorkspace.currentUser,
    fullName: process.env.OPSPILOT_DEV_USER_NAME ?? demoWorkspace.currentUser.fullName,
    role: parseDevRole(process.env.OPSPILOT_DEV_ROLE),
  };

  return {
    user,
    businessId: user.businessId,
  };
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

  const email =
    clerkUser.primaryEmailAddress?.emailAddress ??
    clerkUser.emailAddresses[0]?.emailAddress ??
    "user@opspilot.example";
  const nameFromParts = [clerkUser.firstName, clerkUser.lastName]
    .filter(Boolean)
    .join(" ");
  const fullName = clerkUser.fullName || nameFromParts || email;

  return getWorkspaceRepository().resolveAuthenticatedSession({
    provider: "clerk",
    providerUserId: clerkUser.id,
    email: email.toLowerCase(),
    fullName,
  });
}
