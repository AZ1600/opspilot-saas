import type { WorkspaceSnapshot } from "./types";

export const demoWorkspace: WorkspaceSnapshot = {
  businessId: "business-demo-cleaning",
  businessName: "BrightOps Cleaning Co.",
  niche: "Commercial and residential cleaning",
  onboardingCompleted: false,
  primaryPainPoint: "missed_leads",
  billingPlan: {
    id: "starter",
    name: "Starter",
    priceMonthly: 99,
    actionLimit: 100,
    inboxScanLimit: 250,
  },
  currentUser: {
    id: "user-demo-owner",
    businessId: "business-demo-cleaning",
    email: "owner@brightops.example",
    fullName: "Demo Owner",
    role: "owner",
  },
  teamMembers: [
    {
      id: "user-demo-owner",
      businessId: "business-demo-cleaning",
      email: "owner@brightops.example",
      fullName: "Demo Owner",
      role: "owner",
      status: "active",
    },
  ],
  actions: [
    {
      id: "act-001",
      title: "Reply to high-value cleaning lead",
      source: "Gmail",
      customer: "BrightHomes",
      value: 1850,
      priority: "urgent",
      status: "pending",
      age: "4h",
      summary:
        "A same-week deep clean quote request is unanswered and the lead mentioned a recurring monthly plan.",
      draft:
        "Hi Amara, thanks for reaching out. We can handle the deep clean this week. I can send a quote today if you confirm the property size and preferred time window.",
      reasonCodes: ["unanswered lead", "high value", "recurring potential"],
    },
    {
      id: "act-002",
      title: "Send overdue invoice reminder",
      source: "QuickBooks",
      customer: "Westbridge Offices",
      value: 920,
      priority: "urgent",
      status: "pending",
      age: "12d",
      summary:
        "Invoice OP-1042 is overdue after two completed office cleaning visits.",
      draft:
        "Hi Michael, quick reminder that invoice OP-1042 is now 12 days overdue. Please let us know if you need the payment link resent.",
      reasonCodes: ["overdue invoice", "completed work"],
    },
    {
      id: "act-003",
      title: "Escalate repeat complaint",
      source: "Customer messages",
      customer: "GreenDesk Studio",
      value: 2100,
      priority: "urgent",
      status: "pending",
      age: "2d",
      summary:
        "The customer complained twice about missed bins and may cancel the monthly plan.",
      draft:
        "Hi Daniel, I am sorry this happened twice. I can have a supervisor call today and add a quality check to the next two visits.",
      reasonCodes: ["repeat complaint", "churn risk", "monthly plan"],
    },
    {
      id: "act-004",
      title: "Confirm tomorrow morning booking",
      source: "Calendar",
      customer: "Priya Shah",
      value: 340,
      priority: "normal",
      status: "pending",
      age: "1d",
      summary:
        "A 9:00 AM booking has no access instructions, which can cause a missed visit.",
      draft:
        "Hi Priya, confirming tomorrow's 9:00 AM visit. Could you send the access instructions before 6:00 PM today?",
      reasonCodes: ["booking risk", "missing access"],
    },
  ],
  revenueLeaks: [
    {
      id: "rev-001",
      source: "Gmail",
      issue: "Unanswered quote request",
      customer: "BrightHomes",
      value: 1850,
      age: "4 hours",
      nextMove: "Request property details and send quote",
    },
    {
      id: "rev-002",
      source: "QuickBooks",
      issue: "Invoice OP-1042 overdue",
      customer: "Westbridge Offices",
      value: 920,
      age: "12 days",
      nextMove: "Send payment reminder",
    },
    {
      id: "rev-003",
      source: "CRM",
      issue: "Stale commercial cleaning proposal",
      customer: "Mason Dental",
      value: 3200,
      age: "8 days",
      nextMove: "Follow up with revised start date",
    },
    {
      id: "rev-004",
      source: "Calendar",
      issue: "Recurring slot not renewed",
      customer: "Northpoint Lettings",
      value: 680,
      age: "3 days",
      nextMove: "Ask customer to renew slot",
    },
  ],
  customerRisks: [
    {
      id: "risk-001",
      name: "GreenDesk Studio",
      level: "high",
      value: 2100,
      reason: "Two complaints in 10 days and one unanswered support message.",
      nextMove: "Owner apology plus supervisor quality check.",
    },
    {
      id: "risk-002",
      name: "Mason Dental",
      level: "medium",
      value: 1450,
      reason: "Payment delay and request to reduce weekly service frequency.",
      nextMove: "Offer monthly plan review before churn.",
    },
    {
      id: "risk-003",
      name: "Northpoint Lettings",
      level: "low",
      value: 880,
      reason: "Renewal due in 9 days with no confirmation yet.",
      nextMove: "Send renewal reminder with available slots.",
    },
  ],
  connectedAccounts: [
    {
      id: "gmail-demo",
      provider: "Gmail",
      status: "pending",
      accountLabel: "Simulator ready",
      message: "Connect Gmail to import real business messages.",
    },
    {
      id: "quickbooks-demo",
      provider: "QuickBooks",
      status: "pending",
      accountLabel: "Not connected",
      message: "Invoice sync is planned for overdue-payment recovery.",
    },
    {
      id: "calendar-demo",
      provider: "Calendar",
      status: "pending",
      accountLabel: "Not connected",
      message: "Calendar sync is planned for booking-risk detection.",
    },
    {
      id: "slack-demo",
      provider: "Slack",
      status: "pending",
      accountLabel: "Not connected",
      message: "Slack alerts are planned for urgent approvals.",
    },
  ],
  inboxMessages: [
    {
      id: "gmail-001",
      from: "amara@brighthomes.example",
      subject: "Deep clean quote for Friday",
      receivedAt: "Today, 9:14 AM",
      preview:
        "We need a quote for a deep clean this Friday. Budget is £1,800 and monthly service is possible.",
      body:
        "Customer: BrightHomes. We need a quote for a deep clean this Friday. Budget is £1,800 and we may want monthly service after this.",
      status: "unscanned",
      estimatedValue: 1800,
    },
    {
      id: "gmail-002",
      from: "daniel@greendesk.example",
      subject: "Missed bins again",
      receivedAt: "Today, 10:42 AM",
      preview:
        "This is the second time bins were missed. If it happens again we will cancel the monthly plan.",
      body:
        "Customer: GreenDesk Studio. This is the second time bins were missed and the team is unhappy. If it happens again we will cancel the monthly plan worth £2,100.",
      status: "unscanned",
      estimatedValue: 2100,
    },
    {
      id: "gmail-003",
      from: "accounts@westbridge.example",
      subject: "Payment link for OP-1042",
      receivedAt: "Yesterday, 4:20 PM",
      preview:
        "Invoice OP-1042 for £920 is overdue and accounts asked for the payment link again.",
      body:
        "Customer: Westbridge Offices. Invoice OP-1042 for £920 is overdue and accounts asked for the payment link again.",
      status: "unscanned",
      estimatedValue: 920,
    },
    {
      id: "gmail-004",
      from: "priya@example.com",
      subject: "Access instructions for tomorrow",
      receivedAt: "Yesterday, 2:05 PM",
      preview:
        "Can we confirm tomorrow morning and where should I leave the keys?",
      body:
        "Customer: Priya Shah. Can we confirm tomorrow morning's cleaning appointment and where should I leave the keys for access?",
      status: "unscanned",
      estimatedValue: 340,
    },
  ],
  ingestions: [],
  knowledgeDocuments: [
    {
      id: "doc-001",
      title: "Refund policy",
      type: "Policy",
      body:
        "If a customer reports a missed task within 24 hours, offer a free re-clean or 20 percent credit.",
    },
    {
      id: "doc-002",
      title: "Commercial quote rule",
      type: "Pricing",
      body:
        "Commercial leads over $1,500 should receive a same-day call and written quote within 2 business hours.",
    },
    {
      id: "doc-003",
      title: "Operations playbook",
      type: "Playbook",
      body:
        "Bookings without access instructions should be confirmed before 6:00 PM the day before service.",
    },
  ],
  timeline: [
    {
      id: "time-001",
      title: "Deep clean quote follow-up",
      time: "Today, 2:00 PM",
      owner: "Owner",
      risk: "high",
    },
    {
      id: "time-002",
      title: "Westbridge invoice reminder",
      time: "Today, 4:30 PM",
      owner: "Finance",
      risk: "medium",
    },
    {
      id: "time-003",
      title: "Priya Shah access confirmation",
      time: "Today, 6:00 PM",
      owner: "Scheduler",
      risk: "low",
    },
  ],
  approvalEvents: [],
  impactEntries: [],
  executionJobs: [],
};
