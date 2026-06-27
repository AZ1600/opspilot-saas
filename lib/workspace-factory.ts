import { demoWorkspace } from "@/lib/demo-data";
import { getPlan } from "@/lib/billing";
import type {
  InboxMessage,
  KnowledgeDocument,
  OnboardingProfile,
  TimelineEvent,
  WorkspaceUser,
  WorkspaceSnapshot,
} from "@/lib/types";

export function createWorkspaceFromOnboarding(
  businessId: string,
  profile: OnboardingProfile,
  owner?: WorkspaceUser,
): WorkspaceSnapshot {
  const niche = profile.niche.trim();
  const businessName = profile.businessName.trim();
  const ownerName = profile.ownerName.trim();
  const workspaceOwner: WorkspaceUser = owner
    ? {
        ...owner,
        businessId,
        fullName: ownerName || owner.fullName,
        role: "owner",
      }
    : {
        ...demoWorkspace.currentUser,
        businessId,
        fullName: ownerName,
        email: `${slugify(ownerName || "owner")}@${slugify(businessName || "business")}.example`,
      };

  return {
    ...demoWorkspace,
    businessId,
    businessName,
    niche,
    onboardingCompleted: true,
    primaryPainPoint: profile.primaryPainPoint,
    billingPlan: getPlan("starter"),
    currentUser: workspaceOwner,
    teamMembers: [
      {
        ...workspaceOwner,
        status: "active",
      },
    ],
    actions: [],
    revenueLeaks: [],
    customerRisks: [],
    connectedAccounts: demoWorkspace.connectedAccounts,
    inboxMessages: inboxFor(profile),
    ingestions: [],
    knowledgeDocuments: knowledgeFor(profile),
    timeline: timelineFor(profile),
    approvalEvents: [],
    impactEntries: [],
    executionJobs: [],
  };
}

function inboxFor(profile: OnboardingProfile): InboxMessage[] {
  const businessLabel = profile.businessName || "your business";

  if (profile.primaryPainPoint === "overdue_invoices") {
    return [
      message("gmail-001", "accounts@northstar.example", "Invoice still unpaid", "Customer: Northstar Offices. Invoice INV-2048 for £1,240 is overdue and the payment link may have expired.", 1240),
      message("gmail-002", "emma@oakfield.example", "Question about last quote", "Customer: Oakfield Homes. We liked the quote for £1,700 but need one change before approving monthly service.", 1700),
      message("gmail-003", "support@rivergate.example", "Complaint from site manager", "Customer: Rivergate Studio. The site manager said the last visit missed two agreed tasks and wants a call today.", 1400),
    ];
  }

  if (profile.primaryPainPoint === "customer_complaints") {
    return [
      message("gmail-001", "manager@greendesk.example", "Second complaint this month", "Customer: GreenDesk Studio. This is the second complaint this month and we may cancel the monthly plan worth £2,100.", 2100),
      message("gmail-002", "accounts@westbridge.example", "Payment link request", "Customer: Westbridge Offices. Invoice OP-1042 for £920 is overdue and accounts asked for the payment link again.", 920),
      message("gmail-003", "amara@brighthomes.example", "Need a quote", "Customer: BrightHomes. We need a quote for a deep clean this Friday. Budget is £1,800.", 1800),
    ];
  }

  if (profile.primaryPainPoint === "scheduling") {
    return [
      message("gmail-001", "priya@example.com", "Access instructions", "Customer: Priya Shah. Can we confirm tomorrow morning's appointment and where should I leave the keys for access?", 340),
      message("gmail-002", "ops@northpoint.example", "Recurring slot renewal", "Customer: Northpoint Lettings. We need to renew our recurring slot this week before the next tenant turnover.", 880),
      message("gmail-003", "accounts@westbridge.example", "Invoice overdue", "Customer: Westbridge Offices. Invoice OP-1042 for £920 is overdue and accounts asked for the payment link again.", 920),
    ];
  }

  return [
    message("gmail-001", "amara@brighthomes.example", `Quote request for ${businessLabel}`, "Customer: BrightHomes. We need a quote for a deep clean this Friday. Budget is £1,800 and monthly service is possible.", 1800),
    message("gmail-002", "daniel@greendesk.example", "Missed bins again", "Customer: GreenDesk Studio. This is the second time bins were missed and the team is unhappy. If it happens again we will cancel the monthly plan worth £2,100.", 2100),
    message("gmail-003", "accounts@westbridge.example", "Payment link for OP-1042", "Customer: Westbridge Offices. Invoice OP-1042 for £920 is overdue and accounts asked for the payment link again.", 920),
  ];
}

function knowledgeFor(profile: OnboardingProfile): KnowledgeDocument[] {
  return [
    {
      id: "doc-001",
      title: "Owner approval rule",
      type: "Policy",
      body: `${profile.ownerName || "The owner"} approves every AI draft before it is sent to a customer.`,
    },
    {
      id: "doc-002",
      title: "Primary operations focus",
      type: "Playbook",
      body: `OpsPilot should prioritize ${painPointLabel(profile.primaryPainPoint).toLowerCase()} for ${profile.businessName || "this business"}.`,
    },
    {
      id: "doc-003",
      title: "Same-day response rule",
      type: "Policy",
      body: "Urgent leads, overdue payments, complaints, and booking risks should be reviewed the same business day.",
    },
  ];
}

function timelineFor(profile: OnboardingProfile): TimelineEvent[] {
  return [
    {
      id: "time-001",
      title: `Scan ${profile.niche || "business"} inbox`,
      time: "Today, 2:00 PM",
      owner: profile.ownerName || "Owner",
      risk: "medium",
    },
    {
      id: "time-002",
      title: `Review ${painPointLabel(profile.primaryPainPoint)}`,
      time: "Today, 4:30 PM",
      owner: profile.ownerName || "Owner",
      risk: "high",
    },
  ];
}

function message(
  id: string,
  from: string,
  subject: string,
  body: string,
  estimatedValue: number,
): InboxMessage {
  return {
    id,
    from,
    subject,
    receivedAt: "Today",
    preview: body.replace(/^Customer:\s*/u, "").slice(0, 120),
    body,
    status: "unscanned",
    estimatedValue,
  };
}

function painPointLabel(painPoint: OnboardingProfile["primaryPainPoint"]) {
  if (painPoint === "overdue_invoices") return "Overdue invoices";
  if (painPoint === "customer_complaints") return "Customer complaints";
  if (painPoint === "scheduling") return "Scheduling issues";
  return "Missed leads";
}

function slugify(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ".").replace(/(^\.|\.$)/g, "");
}
