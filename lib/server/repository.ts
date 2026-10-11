import { getWorkspaceStorageCheck } from "@/lib/server/config";
import { fileWorkspaceRepository } from "@/lib/server/workspace-store";
import { postgresWorkspaceRepository } from "@/lib/server/postgres-repository";

export class WorkspaceStorageConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkspaceStorageConfigurationError";
  }
}

export function getWorkspaceRepository() {
  const issue = getWorkspaceStorageCheck();
  if (issue) throw new WorkspaceStorageConfigurationError(issue.message);
  if (process.env.OPSPILOT_REPOSITORY === "postgres") {
    return postgresWorkspaceRepository;
  }

  return fileWorkspaceRepository;
}
