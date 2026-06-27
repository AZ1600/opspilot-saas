import { fileWorkspaceRepository } from "@/lib/server/workspace-store";
import { postgresWorkspaceRepository } from "@/lib/server/postgres-repository";

export function getWorkspaceRepository() {
  if (process.env.OPSPILOT_REPOSITORY === "postgres") {
    return postgresWorkspaceRepository;
  }

  return fileWorkspaceRepository;
}
