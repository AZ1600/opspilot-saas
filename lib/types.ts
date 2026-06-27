export type Priority = "urgent" | "normal" | "low";
export type ActionStatus = "pending" | "approved" | "dismissed";
export type RiskLevel = "high" | "medium" | "low";

export type BusinessAction = {
  id: string;
  title: string;
  source: "Gmail" | "QuickBooks" | "Calendar" | "Customer messages" | "CRM";
  customer: string;
  value: number;
  priority: Priority;
  status: ActionStatus;
  age: string;
  summary: string;
  draft: string;
  reasonCodes: string[];
};

export type RevenueLeak = {
  id: string;
  source: string;
  issue: string;
  customer: string;
  value: number;
  age: string;
  nextMove: string;
};

export type CustomerRisk = {
  id: string;
  name: string;
  level: RiskLevel;
  value: number;
  reason: string;
  nextMove: string;
};

export type IngestionRecord = {
  id: string;
  source: "Manual paste" | "Gmail" | "QuickBooks" | "Calendar" | "Slack";
  classifier: "rules" | "openai";
  rawText: string;
  detectedCategory: "lead" | "invoice" | "complaint" | "booking" | "general";
  summary: string;
  createdAt: string;
};

export type InboxMessage = {
  id: string;
  from: string;
  subject: string;
  receivedAt: string;
  preview: string;
  body: string;
  status: "unscanned" | "scanned";
  estimatedValue: number;
};

export type ConnectedAccount = {
  id: string;
  provider: "Gmail" | "QuickBooks" | "Calendar" | "Slack";
  status: "connected" | "pending" | "failed";
  accountLabel: string;
  connectedAt?: string;
  lastImportedAt?: string;
  message?: string;
};

export type PainPoint =
  | "missed_leads"
  | "overdue_invoices"
  | "customer_complaints"
  | "scheduling";

export type OnboardingProfile = {
  businessName: string;
  ownerName: string;
  niche: string;
  primaryPainPoint: PainPoint;
};

export type WorkspaceSettings = OnboardingProfile;

export type BillingPlan = {
  id: "starter" | "growth" | "pro";
  name: string;
  priceMonthly: number;
  actionLimit: number;
  inboxScanLimit: number;
};

export type KnowledgeDocument = {
  id: string;
  title: string;
  type: "Policy" | "Pricing" | "Playbook" | "Contract" | "Note";
  body: string;
};

export type TimelineEvent = {
  id: string;
  title: string;
  time: string;
  owner: string;
  risk: RiskLevel;
};

export type WorkspaceUser = {
  id: string;
  businessId: string;
  email: string;
  fullName: string;
  role: "owner" | "manager" | "staff";
};

export type TeamMember = WorkspaceUser & {
  status: "active" | "invited";
  invitedAt?: string;
};

export type TeamInvite = {
  email: string;
  fullName: string;
  role: Exclude<WorkspaceUser["role"], "owner">;
};

export type ApprovalEvent = {
  id: string;
  actionId: string;
  actionTitle: string;
  decision: Extract<ActionStatus, "approved" | "dismissed">;
  actor: string;
  createdAt: string;
};

export type ImpactEntry = {
  id: string;
  actionId: string;
  actionTitle: string;
  category:
    | "recovered_revenue"
    | "protected_revenue"
    | "invoice_follow_up"
    | "time_saved";
  customer: string;
  source: BusinessAction["source"];
  amount: number;
  timeSavedMinutes: number;
  confidence: "estimated" | "confirmed";
  note: string;
  createdAt: string;
};

export type ExecutionJob = {
  id: string;
  actionId: string;
  actionTitle: string;
  type:
    | "send_email"
    | "create_follow_up"
    | "invoice_reminder"
    | "customer_recovery";
  status: "queued" | "completed" | "failed";
  customer: string;
  owner: string;
  detail: string;
  createdAt: string;
  updatedAt: string;
};

export type WorkspaceSnapshot = {
  businessId: string;
  businessName: string;
  niche: string;
  onboardingCompleted: boolean;
  primaryPainPoint: PainPoint;
  billingPlan: BillingPlan;
  currentUser: WorkspaceUser;
  teamMembers: TeamMember[];
  actions: BusinessAction[];
  revenueLeaks: RevenueLeak[];
  customerRisks: CustomerRisk[];
  connectedAccounts: ConnectedAccount[];
  inboxMessages: InboxMessage[];
  ingestions: IngestionRecord[];
  knowledgeDocuments: KnowledgeDocument[];
  timeline: TimelineEvent[];
  approvalEvents: ApprovalEvent[];
  impactEntries: ImpactEntry[];
  executionJobs: ExecutionJob[];
};
