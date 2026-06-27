import { NextResponse } from "next/server";
import { getRuntimeConfigReport } from "@/lib/server/config";
import { getWorkspaceRepository } from "@/lib/server/repository";

export const runtime = "nodejs";

export async function GET() {
  const config = getRuntimeConfigReport();
  const startedAt = Date.now();
  let repositoryReachable = false;
  let repositoryLatencyMs: number | null = null;

  try {
    await getWorkspaceRepository().read("business-demo-cleaning");
    repositoryReachable = true;
    repositoryLatencyMs = Date.now() - startedAt;
  } catch {
    repositoryReachable = false;
  }

  const ok = config.ok && repositoryReachable;

  return NextResponse.json(
    {
      ok,
      service: "opspilot-saas",
      timestamp: new Date().toISOString(),
      config,
      dependencies: {
        repository: {
          reachable: repositoryReachable,
          latencyMs: repositoryLatencyMs,
          mode: config.repository,
        },
      },
    },
    { status: ok ? 200 : 503 },
  );
}
