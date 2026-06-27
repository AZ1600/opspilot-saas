import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { demoWorkspace } from "@/lib/demo-data";
import type { WorkspaceSnapshot, WorkspaceUser } from "@/lib/types";

export const sessionCookieName = "opspilot_session";

export type RequestSession = {
  user: WorkspaceUser;
  businessId: string;
};

export async function requireSession(): Promise<RequestSession> {
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
