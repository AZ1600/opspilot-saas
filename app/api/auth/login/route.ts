import { NextRequest, NextResponse } from "next/server";
import {
  createSessionCookieValue,
  isClerkConfigured,
  sessionCookieName,
} from "@/lib/server/auth";
import { getWorkspaceRepository } from "@/lib/server/repository";
import { isDemoAuthAllowed } from "@/lib/server/config";
import type { WorkspaceUser } from "@/lib/types";

export const runtime = "nodejs";

const roles = new Set<WorkspaceUser["role"]>(["owner", "manager", "staff"]);

export async function POST(request: NextRequest) {
  if (!isDemoAuthAllowed() || isClerkConfigured()) {
    return NextResponse.json(
      { error: "Demo login is unavailable in this environment." },
      { status: 403 },
    );
  }

  let body: FormData | URLSearchParams;
  try {
    body = await readBody(request);
  } catch {
    return NextResponse.json(
      { error: "Request body must contain a valid login form or JSON object." },
      { status: 400 },
    );
  }

  const role = body.get("role");
  const name = body.get("fullName");

  if (typeof role !== "string" || !roles.has(role as WorkspaceUser["role"])) {
    return NextResponse.json({ error: "Choose a valid role." }, { status: 400 });
  }

  if (name !== null && typeof name !== "string") {
    return NextResponse.json({ error: "Full name must be text." }, { status: 400 });
  }

  const defaultName = role === "owner"
    ? "Demo Owner"
    : role === "manager" ? "Demo Manager" : "Demo Staff";
  const user: WorkspaceUser = {
    id: `user-demo-${role}`,
    businessId: "business-demo-cleaning",
    email: `${role}@brightops.example`,
    fullName: name?.trim() || defaultName,
    role: role as WorkspaceUser["role"],
  };
  const session = await getWorkspaceRepository().resolveDemoSession(user, { updateName: true });
  const response = NextResponse.redirect(new URL("/", request.url), 303);

  response.cookies.set(sessionCookieName, createSessionCookieValue(session.user), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });

  return response;
}

async function readBody(request: NextRequest) {
  const contentType = request.headers.get("content-type") ?? "";

  if (contentType.includes("application/json")) {
    const json: unknown = await request.json();
    if (typeof json !== "object" || json === null || Array.isArray(json)) {
      throw new Error("Expected a JSON object.");
    }

    const record = json as Record<string, unknown>;
    const fields: Record<string, string> = {};
    for (const field of ["fullName", "role"] as const) {
      if (field in record) {
        const value = record[field];
        if (typeof value !== "string") {
          throw new Error("Login fields must be text.");
        }
        fields[field] = value;
      }
    }
    return new URLSearchParams(fields);
  }

  return request.formData();
}
