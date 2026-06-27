import { NextRequest, NextResponse } from "next/server";
import {
  createSessionCookieValue,
  sessionCookieName,
} from "@/lib/server/auth";
import type { WorkspaceUser } from "@/lib/types";

export const runtime = "nodejs";

const roles = new Set<WorkspaceUser["role"]>(["owner", "manager", "staff"]);

export async function POST(request: NextRequest) {
  const body = await readBody(request);
  const role = body.get("role")?.toString();
  const fullName = body.get("fullName")?.toString().trim() || "Demo Owner";

  if (!roles.has(role as WorkspaceUser["role"])) {
    return NextResponse.json({ error: "Choose a valid role." }, { status: 400 });
  }

  const user: WorkspaceUser = {
    id: `user-demo-${role}`,
    businessId: "business-demo-cleaning",
    email: `${role}@brightops.example`,
    fullName,
    role: role as WorkspaceUser["role"],
  };
  const response = NextResponse.redirect(new URL("/", request.url), 303);

  response.cookies.set(sessionCookieName, createSessionCookieValue(user), {
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
    const json = (await request.json()) as { fullName?: string; role?: string };
    return new URLSearchParams({
      ...(json.fullName ? { fullName: json.fullName } : {}),
      ...(json.role ? { role: json.role } : {}),
    });
  }

  return request.formData();
}
