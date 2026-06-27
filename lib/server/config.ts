type ConfigCheck = {
  key: string;
  message: string;
  severity: "error" | "warning";
};

export type RuntimeConfigReport = {
  aiProvider: string;
  environment: string;
  gmailMode: "mock" | "oauth";
  ok: boolean;
  repository: string;
  checks: ConfigCheck[];
};

export function getRuntimeConfigReport(): RuntimeConfigReport {
  const repository = process.env.OPSPILOT_REPOSITORY ?? "file";
  const aiProvider = process.env.OPSPILOT_AI_PROVIDER ?? "rules";
  const environment = process.env.NODE_ENV ?? "development";
  const checks: ConfigCheck[] = [];
  const gmailMode = hasGoogleOAuthConfig() ? "oauth" : "mock";

  if (repository !== "file" && repository !== "postgres") {
    checks.push({
      key: "OPSPILOT_REPOSITORY",
      message: "Use file or postgres.",
      severity: "error",
    });
  }

  if (repository === "postgres" && !process.env.DATABASE_URL) {
    checks.push({
      key: "DATABASE_URL",
      message: "Required when OPSPILOT_REPOSITORY=postgres.",
      severity: "error",
    });
  }

  if (aiProvider !== "rules" && aiProvider !== "openai") {
    checks.push({
      key: "OPSPILOT_AI_PROVIDER",
      message: "Use rules or openai.",
      severity: "error",
    });
  }

  if (aiProvider === "openai" && !process.env.OPENAI_API_KEY) {
    checks.push({
      key: "OPENAI_API_KEY",
      message: "Required when OPSPILOT_AI_PROVIDER=openai.",
      severity: "error",
    });
  }

  if (environment === "production") {
    if (!process.env.OPSPILOT_SESSION_SECRET) {
      checks.push({
        key: "OPSPILOT_SESSION_SECRET",
        message: "Set a strong session secret in production.",
        severity: "error",
      });
    }

    if (repository === "file") {
      checks.push({
        key: "OPSPILOT_REPOSITORY",
        message: "File storage is for demos; use postgres for production.",
        severity: "warning",
      });
    }
  }

  if (hasPartialGoogleOAuthConfig()) {
    checks.push({
      key: "GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET/GOOGLE_REDIRECT_URI",
      message: "Set all Google OAuth variables or none of them.",
      severity: "error",
    });
  }

  if (gmailMode === "oauth" && !process.env.OPSPILOT_TOKEN_ENCRYPTION_KEY) {
    checks.push({
      key: "OPSPILOT_TOKEN_ENCRYPTION_KEY",
      message: "Set this before using real Gmail OAuth tokens.",
      severity: "warning",
    });
  }

  return {
    aiProvider,
    environment,
    gmailMode,
    ok: checks.every((check) => check.severity !== "error"),
    repository,
    checks,
  };
}

function hasGoogleOAuthConfig() {
  return Boolean(
    process.env.GOOGLE_CLIENT_ID &&
      process.env.GOOGLE_CLIENT_SECRET &&
      process.env.GOOGLE_REDIRECT_URI,
  );
}

function hasPartialGoogleOAuthConfig() {
  const values = [
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI,
  ];
  const present = values.filter(Boolean).length;

  return present > 0 && present < values.length;
}
