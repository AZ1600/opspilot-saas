import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { demoWorkspace } from "@/lib/demo-data";
import { getPlan } from "@/lib/billing";
import { getWritableDataDir } from "@/lib/server/file-storage";
import { createWorkspaceFromOnboarding } from "@/lib/workspace-factory";
import type {
  ActionStatus,
  ApprovalEvent,
  BusinessAction,
  ExecutionJob,
  ImpactEntry,
  OnboardingProfile,
  TeamInvite,
  WorkspaceUser,
  WorkspaceSettings,
  WorkspaceSnapshot,
} from "@/lib/types";
import type {
  AuthenticatedIdentity,
  BillingState,
  DecisionStatus,
  ExecutionStatus,
  InboxImport,
  InboxScanInsert,
  IngestionInsert,
  ResolvedSession,
  ScanInsert,
  StripeBillingUpdate,
  StripeCustomerBillingUpdate,
  WorkspaceRepository,
} from "@/lib/server/workspace-repository";

function workspacePathFor(businessId: string) {
  return join(getWritableDataDir(), `${businessId}.json`);
}

function seedWorkspaceFor(businessId: string): WorkspaceSnapshot {
  return {
    ...demoWorkspace,
    businessId,
    currentUser: {
      ...demoWorkspace.currentUser,
      businessId,
    },
  };
}

function normalizeWorkspace(
  workspace: Partial<WorkspaceSnapshot>,
  businessId: string,
): WorkspaceSnapshot {
  const seed = seedWorkspaceFor(businessId);

  return {
    ...seed,
    ...workspace,
    businessId,
    onboardingCompleted: workspace.onboardingCompleted ?? seed.onboardingCompleted,
    primaryPainPoint: workspace.primaryPainPoint ?? seed.primaryPainPoint,
    billingPlan: workspace.billingPlan ?? seed.billingPlan,
    currentUser: {
      ...seed.currentUser,
      ...workspace.currentUser,
      businessId,
    },
    teamMembers: workspace.teamMembers ?? seed.teamMembers,
    actions: workspace.actions ?? seed.actions,
    revenueLeaks: workspace.revenueLeaks ?? seed.revenueLeaks,
    customerRisks: workspace.customerRisks ?? seed.customerRisks,
    connectedAccounts: workspace.connectedAccounts ?? seed.connectedAccounts,
    inboxMessages: workspace.inboxMessages ?? seed.inboxMessages,
    ingestions: workspace.ingestions ?? seed.ingestions,
    knowledgeDocuments: workspace.knowledgeDocuments ?? seed.knowledgeDocuments,
    timeline: workspace.timeline ?? seed.timeline,
    approvalEvents: workspace.approvalEvents ?? seed.approvalEvents,
    impactEntries: workspace.impactEntries ?? seed.impactEntries,
    executionJobs: workspace.executionJobs ?? seed.executionJobs,
  };
}

export async function updateBillingPlan(
  businessId: string,
  planId: "starter" | "growth" | "pro",
) {
  const workspace = await readWorkspace(businessId);
  const nextWorkspace: WorkspaceSnapshot = {
    ...workspace,
    billingPlan: getPlan(planId),
  };

  await writeWorkspace(businessId, nextWorkspace);
  return nextWorkspace;
}

export async function readBillingState(): Promise<BillingState> {
  return {
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    subscriptionStatus: null,
  };
}

export async function updateStripeBilling(update: StripeBillingUpdate) {
  await updateBillingPlan(update.businessId, update.planId);
}

export async function updateStripeBillingByCustomer(
  _update: StripeCustomerBillingUpdate,
) {
  return;
}

export async function inviteTeamMember(
  businessId: string,
  invite: TeamInvite,
) {
  const workspace = await readWorkspace(businessId);
  const normalizedEmail = invite.email.trim().toLowerCase();
  const existingMember = workspace.teamMembers.find(
    (member) => member.email.toLowerCase() === normalizedEmail,
  );

  if (existingMember) {
    return workspace;
  }

  const nextWorkspace: WorkspaceSnapshot = {
    ...workspace,
    teamMembers: [
      ...workspace.teamMembers,
      {
        id: `user-${Date.now()}`,
        businessId,
        email: normalizedEmail,
        fullName: invite.fullName.trim(),
        role: invite.role,
        status: "invited",
        invitedAt: new Date().toISOString(),
      },
    ],
  };

  await writeWorkspace(businessId, nextWorkspace);
  return nextWorkspace;
}


async function ensureWorkspaceFile(businessId: string) {
  const workspacePath = workspacePathFor(businessId);
  await mkdir(getWritableDataDir(), { recursive: true });

  try {
    await readFile(workspacePath, "utf8");
  } catch {
    await writeWorkspace(businessId, seedWorkspaceFor(businessId));
  }
}

export async function readWorkspace(businessId: string): Promise<WorkspaceSnapshot> {
  await ensureWorkspaceFile(businessId);

  const workspacePath = workspacePathFor(businessId);
  const raw = await readFile(workspacePath, "utf8");
  return normalizeWorkspace(JSON.parse(raw) as Partial<WorkspaceSnapshot>, businessId);
}

export async function writeWorkspace(
  businessId: string,
  workspace: WorkspaceSnapshot,
) {
  const workspacePath = workspacePathFor(businessId);
  await mkdir(getWritableDataDir(), { recursive: true });
  await writeFile(workspacePath, JSON.stringify(workspace, null, 2));
}

export async function resetWorkspace(businessId: string) {
  const workspace = seedWorkspaceFor(businessId);
  await writeWorkspace(businessId, workspace);
  return workspace;
}

export async function onboardWorkspace(
  businessId: string,
  profile: OnboardingProfile,
  owner?: WorkspaceUser,
) {
  const workspace = createWorkspaceFromOnboarding(businessId, profile, owner);
  await writeWorkspace(businessId, workspace);
  return workspace;
}

export async function resolveAuthenticatedSession(
  identity: AuthenticatedIdentity,
): Promise<ResolvedSession> {
  const businessId = `business-${slugifyIdentity(identity.providerUserId)}`;
  const workspace = await readWorkspace(businessId);
  const existingMember = workspace.teamMembers.find(
    (member) => member.email.toLowerCase() === identity.email.toLowerCase(),
  );
  const user: WorkspaceUser = existingMember
    ? {
        id: existingMember.id,
        businessId,
        email: existingMember.email,
        fullName: existingMember.fullName,
        role: existingMember.role,
      }
    : {
        id: `${identity.provider}-${identity.providerUserId}`,
        businessId,
        email: identity.email,
        fullName: identity.fullName,
        role: "owner",
      };

  if (!existingMember) {
    await writeWorkspace(businessId, {
      ...workspace,
      currentUser: user,
      teamMembers: [
        {
          ...user,
          status: "active",
        },
        ...workspace.teamMembers.filter((member) => member.role !== "owner"),
      ],
    });
  }

  return {
    businessId,
    user,
  };
}

export async function updateWorkspaceSettings(
  businessId: string,
  settings: WorkspaceSettings,
) {
  const workspace = await readWorkspace(businessId);
  const nextWorkspace: WorkspaceSnapshot = {
    ...workspace,
    businessName: settings.businessName,
    niche: settings.niche,
    primaryPainPoint: settings.primaryPainPoint,
    currentUser: {
      ...workspace.currentUser,
      fullName: settings.ownerName,
    },
    knowledgeDocuments: workspace.knowledgeDocuments.map((document) =>
      document.id === "doc-002"
        ? {
            ...document,
            body: `OpsPilot should prioritize ${settings.primaryPainPoint.replaceAll("_", " ")} for ${settings.businessName}.`,
          }
        : document,
    ),
  };

  await writeWorkspace(businessId, nextWorkspace);
  return nextWorkspace;
}

export async function addScanToWorkspace(businessId: string, scan: ScanInsert) {
  const workspace = await readWorkspace(businessId);
  const nextWorkspace: WorkspaceSnapshot = {
    ...workspace,
    actions: [...scan.actions, ...workspace.actions],
    revenueLeaks: [...scan.revenueLeaks, ...workspace.revenueLeaks],
  };

  await writeWorkspace(businessId, nextWorkspace);
  return nextWorkspace;
}

export async function addIngestionToWorkspace(
  businessId: string,
  ingestion: IngestionInsert,
) {
  const workspace = await readWorkspace(businessId);
  const nextWorkspace: WorkspaceSnapshot = {
    ...workspace,
    ingestions: [ingestion.ingestion, ...(workspace.ingestions ?? [])],
    actions: [...ingestion.actions, ...workspace.actions],
    revenueLeaks: [...ingestion.revenueLeaks, ...workspace.revenueLeaks],
    customerRisks: [...ingestion.customerRisks, ...workspace.customerRisks],
  };

  await writeWorkspace(businessId, nextWorkspace);
  return nextWorkspace;
}

export async function addInboxScanToWorkspace(
  businessId: string,
  scan: InboxScanInsert,
) {
  const workspace = await readWorkspace(businessId);
  const scannedIds = new Set(scan.scannedMessageIds);
  const nextWorkspace: WorkspaceSnapshot = {
    ...workspace,
    inboxMessages: workspace.inboxMessages.map((message) =>
      scannedIds.has(message.id) ? { ...message, status: "scanned" } : message,
    ),
    ingestions: [scan.ingestion, ...(workspace.ingestions ?? [])],
    actions: [...scan.actions, ...workspace.actions],
    revenueLeaks: [...scan.revenueLeaks, ...workspace.revenueLeaks],
    customerRisks: [...scan.customerRisks, ...workspace.customerRisks],
  };

  await writeWorkspace(businessId, nextWorkspace);
  return nextWorkspace;
}

export async function upsertConnectedAccount(
  businessId: string,
  account: WorkspaceSnapshot["connectedAccounts"][number],
) {
  const workspace = await readWorkspace(businessId);
  const existing = workspace.connectedAccounts.some((item) => item.id === account.id);
  const nextWorkspace: WorkspaceSnapshot = {
    ...workspace,
    connectedAccounts: existing
      ? workspace.connectedAccounts.map((item) =>
          item.id === account.id ? account : item,
        )
      : [account, ...workspace.connectedAccounts],
  };

  await writeWorkspace(businessId, nextWorkspace);
  return nextWorkspace;
}

export async function importInboxMessages(
  businessId: string,
  inboxImport: InboxImport,
) {
  const workspace = await readWorkspace(businessId);
  const existingIds = new Set(workspace.inboxMessages.map((message) => message.id));
  const importedMessages = inboxImport.messages.filter(
    (message) => !existingIds.has(message.id),
  );
  const nextWorkspace: WorkspaceSnapshot = {
    ...workspace,
    connectedAccounts: workspace.connectedAccounts.map((account) =>
      account.id === inboxImport.account.id ? inboxImport.account : account,
    ),
    inboxMessages: [...importedMessages, ...workspace.inboxMessages],
  };

  await writeWorkspace(businessId, nextWorkspace);
  return nextWorkspace;
}

export async function updateActionDecision(
  businessId: string,
  actionId: string,
  status: Extract<ActionStatus, "approved" | "dismissed">,
  actor: string,
) {
  const workspace = await readWorkspace(businessId);
  const action = workspace.actions.find((item) => item.id === actionId);

  if (!action) {
    return null;
  }

  const event: ApprovalEvent = {
    id: `approval-${Date.now()}`,
    actionId,
    actionTitle: action.title,
    decision: status,
    actor,
    createdAt: new Date().toISOString(),
  };
  const impact = status === "approved" ? createImpactEntry(action) : null;
  const executionJob = status === "approved" ? createExecutionJob(action, actor) : null;

  const nextWorkspace: WorkspaceSnapshot = {
    ...workspace,
    actions: workspace.actions.map((item) =>
      item.id === actionId ? { ...item, status } : item,
    ),
    approvalEvents: [event, ...workspace.approvalEvents],
    impactEntries: impact
      ? [impact, ...workspace.impactEntries.filter((item) => item.actionId !== actionId)]
      : workspace.impactEntries,
    executionJobs: executionJob
      ? [
          executionJob,
          ...workspace.executionJobs.filter((item) => item.actionId !== actionId),
        ]
      : workspace.executionJobs,
  };

  await writeWorkspace(businessId, nextWorkspace);
  return nextWorkspace;
}

export async function updateExecutionJobStatus(
  businessId: string,
  jobId: string,
  status: ExecutionStatus,
) {
  const workspace = await readWorkspace(businessId);
  const job = workspace.executionJobs.find((item) => item.id === jobId);

  if (!job) {
    return null;
  }

  const nextWorkspace: WorkspaceSnapshot = {
    ...workspace,
    executionJobs: workspace.executionJobs.map((item) =>
      item.id === jobId
        ? { ...item, status, updatedAt: new Date().toISOString() }
        : item,
    ),
  };

  await writeWorkspace(businessId, nextWorkspace);
  return nextWorkspace;
}

function createExecutionJob(action: BusinessAction, actor: string): ExecutionJob {
  const now = new Date().toISOString();
  const type = executionTypeFor(action);

  return {
    id: `exec-${Date.now()}`,
    actionId: action.id,
    actionTitle: action.title,
    type,
    status: "queued",
    customer: action.customer,
    owner: actor,
    detail: executionDetailFor(type, action),
    createdAt: now,
    updatedAt: now,
  };
}

function executionTypeFor(action: BusinessAction): ExecutionJob["type"] {
  const reasonText = action.reasonCodes.join(" ").toLowerCase();
  const title = action.title.toLowerCase();

  if (reasonText.includes("invoice") || title.includes("invoice")) {
    return "invoice_reminder";
  }

  if (reasonText.includes("complaint") || reasonText.includes("churn")) {
    return "customer_recovery";
  }

  if (action.source === "Gmail" || action.source === "Customer messages") {
    return "send_email";
  }

  return "create_follow_up";
}

function executionDetailFor(
  type: ExecutionJob["type"],
  action: BusinessAction,
) {
  if (type === "invoice_reminder") {
    return `Queue invoice/payment follow-up for ${action.customer}.`;
  }

  if (type === "customer_recovery") {
    return `Queue recovery response and owner follow-up for ${action.customer}.`;
  }

  if (type === "send_email") {
    return `Queue approved email draft for ${action.customer}.`;
  }

  return `Create follow-up task for ${action.customer}.`;
}

function createImpactEntry(action: BusinessAction): ImpactEntry {
  const category = impactCategoryFor(action);

  return {
    id: `impact-${Date.now()}`,
    actionId: action.id,
    actionTitle: action.title,
    category,
    customer: action.customer,
    source: action.source,
    amount: category === "time_saved" ? 0 : action.value,
    timeSavedMinutes: category === "time_saved" ? 45 : 25,
    confidence: "estimated",
    note: impactNoteFor(category, action),
    createdAt: new Date().toISOString(),
  };
}

function impactCategoryFor(action: BusinessAction): ImpactEntry["category"] {
  const reasonText = action.reasonCodes.join(" ").toLowerCase();
  const title = action.title.toLowerCase();

  if (reasonText.includes("complaint") || reasonText.includes("churn")) {
    return "protected_revenue";
  }

  if (reasonText.includes("invoice") || title.includes("invoice")) {
    return "invoice_follow_up";
  }

  if (action.value <= 0) {
    return "time_saved";
  }

  return "recovered_revenue";
}

function impactNoteFor(
  category: ImpactEntry["category"],
  action: BusinessAction,
) {
  if (category === "protected_revenue") {
    return `Approved intervention may protect ${action.customer} revenue.`;
  }

  if (category === "invoice_follow_up") {
    return `Approved follow-up moves ${action.customer} invoice recovery forward.`;
  }

  if (category === "time_saved") {
    return `Approved action reduces manual operations follow-up.`;
  }

  return `Approved action may recover revenue from ${action.customer}.`;
}

export const fileWorkspaceRepository: WorkspaceRepository = {
  read: readWorkspace,
  resolveAuthenticatedSession,
  reset: resetWorkspace,
  onboard: onboardWorkspace,
  updateSettings: updateWorkspaceSettings,
  updateBillingPlan,
  readBillingState,
  updateStripeBilling,
  updateStripeBillingByCustomer,
  inviteTeamMember,
  addScan: addScanToWorkspace,
  addIngestion: addIngestionToWorkspace,
  addInboxScan: addInboxScanToWorkspace,
  upsertConnectedAccount,
  importInboxMessages,
  updateExecutionJobStatus,
  updateActionDecision: (
    businessId: string,
    actionId: string,
    status: DecisionStatus,
    actor: string,
  ) => updateActionDecision(businessId, actionId, status, actor),
};

function slugifyIdentity(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
