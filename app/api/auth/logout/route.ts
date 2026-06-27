import { NextRequest, NextResponse } from "next/server";
import { sessionCookieName } from "@/lib/server/auth";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const response = NextResponse.redirect(new URL("/login", request.url), 303);

  response.cookies.delete(sessionCookieName);
  return response;
}
