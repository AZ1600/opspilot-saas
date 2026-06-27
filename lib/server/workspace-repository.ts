import type {
  ActionStatus,
  IngestionRecord,
  InboxMessage,
  OnboardingProfile,
  ConnectedAccount,
  TeamInvite,
  WorkspaceUser,
  WorkspaceSettings,
  WorkspaceSnapshot,
} from "@/lib/types";

export type ScanInsert = Pick<WorkspaceSnapshot, "actions" | "revenueLeaks">;
export type IngestionInsert = {
  ingestion: IngestionRecord;
  actions: WorkspaceSnapshot["actions"];
  revenueLeaks: WorkspaceSnapshot["revenueLeaks"];
  customerRisks: WorkspaceSnapshot["customerRisks"];
};
export type InboxScanInsert = IngestionInsert & {
  scannedMessageIds: string[];
};
export type ConnectorUpdate = ConnectedAccount;
export type InboxImport = {
  account: ConnectedAccount;
  messages: InboxMessage[];
};
export type DecisionStatus = Extract<ActionStatus, "approved" | "dismissed">;
export type ExecutionStatus = Extract<
  WorkspaceSnapshot["executionJobs"][number]["status"],
  "completed" | "failed"
>;
export type AuthenticatedIdentity = {
  provider: "clerk";
  providerUserId: string;
  email: string;
  fullName: string;
};
export type ResolvedSession = {
  user: WorkspaceUser;
  businessId: string;
};

export type WorkspaceRepository = {
  read(businessId: string): Promise<WorkspaceSnapshot>;
  resolveAuthenticatedSession(
    identity: AuthenticatedIdentity,
  ): Promise<ResolvedSession>;
  reset(businessId: string): Promise<WorkspaceSnapshot>;
  onboard(
    businessId: string,
    profile: OnboardingProfile,
    owner?: WorkspaceUser,
  ): Promise<WorkspaceSnapshot>;
  updateSettings(
    businessId: string,
    settings: WorkspaceSettings,
  ): Promise<WorkspaceSnapshot>;
  updateBillingPlan(
    businessId: string,
    planId: "starter" | "growth" | "pro",
  ): Promise<WorkspaceSnapshot>;
  inviteTeamMember(
    businessId: string,
    invite: TeamInvite,
  ): Promise<WorkspaceSnapshot>;
  addScan(businessId: string, scan: ScanInsert): Promise<WorkspaceSnapshot>;
  addIngestion(
    businessId: string,
    ingestion: IngestionInsert,
  ): Promise<WorkspaceSnapshot>;
  addInboxScan(
    businessId: string,
    scan: InboxScanInsert,
  ): Promise<WorkspaceSnapshot>;
  upsertConnectedAccount(
    businessId: string,
    account: ConnectorUpdate,
  ): Promise<WorkspaceSnapshot>;
  importInboxMessages(
    businessId: string,
    inboxImport: InboxImport,
  ): Promise<WorkspaceSnapshot>;
  updateActionDecision(
    businessId: string,
    actionId: string,
    status: DecisionStatus,
    actor: string,
  ): Promise<WorkspaceSnapshot | null>;
  updateExecutionJobStatus(
    businessId: string,
    jobId: string,
    status: ExecutionStatus,
  ): Promise<WorkspaceSnapshot | null>;
};
