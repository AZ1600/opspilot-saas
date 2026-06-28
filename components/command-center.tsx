"use client";

import { SignOutButton, UserButton } from "@clerk/nextjs";
import { useEffect, useMemo, useState } from "react";
import type { AuthMode } from "@/lib/server/auth";
import type {
  ActionStatus,
  BillingPlan,
  BusinessAction,
  InboxMessage,
  OnboardingProfile,
  PainPoint,
  TeamInvite,
  WorkspaceSnapshot,
} from "@/lib/types";
import { billingPlans } from "@/lib/billing";

type View =
  | "overview"
  | "brief"
  | "inbox"
  | "ingest"
  | "actions"
  | "execution"
  | "revenue"
  | "customers"
  | "impact"
  | "knowledge"
  | "billing"
  | "settings";
type Filter = "all" | "urgent" | "pending";
type ClientPermission =
  | "actions:approve"
  | "billing:manage"
  | "inbox:scan"
  | "ingestions:create"
  | "settings:manage"
  | "team:manage"
  | "workspace:reset";

type CommandCenterProps = {
  authMode: AuthMode;
  initialWorkspace: WorkspaceSnapshot;
};
type CustomerProfile = {
  name: string;
  risk: "high" | "medium" | "low";
  lifetimeValue: number;
  openActionCount: number;
  urgentActionCount: number;
  unpaidValue: number;
  complaintCount: number;
  inboxCount: number;
  impactValue: number;
  lastSignal: string;
  nextMove: string;
  actions: WorkspaceSnapshot["actions"];
  revenueLeaks: WorkspaceSnapshot["revenueLeaks"];
  risks: WorkspaceSnapshot["customerRisks"];
  messages: WorkspaceSnapshot["inboxMessages"];
};
type DailyBrief = {
  headline: string;
  summary: string;
  topActions: WorkspaceSnapshot["actions"];
  topCustomers: CustomerProfile[];
  revenueAtRisk: number;
  unreadSignals: number;
  approvedToday: number;
  nextBestMove: string;
};

const currency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});
const monthLabels = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const clientPermissions: Record<
  WorkspaceSnapshot["currentUser"]["role"],
  ClientPermission[]
> = {
  owner: [
    "actions:approve",
    "billing:manage",
    "inbox:scan",
    "ingestions:create",
    "settings:manage",
    "team:manage",
    "workspace:reset",
  ],
  manager: ["actions:approve", "inbox:scan", "ingestions:create"],
  staff: [],
};

function can(
  role: WorkspaceSnapshot["currentUser"]["role"],
  permission: ClientPermission,
) {
  return clientPermissions[role].includes(permission);
}

function formatDateTime(value: string) {
  const date = new Date(value);
  const hours = date.getUTCHours();
  const minutes = date.getUTCMinutes().toString().padStart(2, "0");
  const period = hours >= 12 ? "PM" : "AM";
  const displayHours = hours % 12 || 12;

  return `${monthLabels[date.getUTCMonth()]} ${date.getUTCDate()}, ${date.getUTCFullYear()}, ${displayHours}:${minutes} ${period}`;
}

function buildCustomerProfiles(workspace: WorkspaceSnapshot): CustomerProfile[] {
  const profiles = new Map<string, CustomerProfile>();

  function ensureProfile(name: string) {
    const cleanName = normalizeCustomerName(name);
    const existing = profiles.get(cleanName);

    if (existing) {
      return existing;
    }

    const profile: CustomerProfile = {
      name: cleanName,
      risk: "low",
      lifetimeValue: 0,
      openActionCount: 0,
      urgentActionCount: 0,
      unpaidValue: 0,
      complaintCount: 0,
      inboxCount: 0,
      impactValue: 0,
      lastSignal: "No recent signal",
      nextMove: "Review account context",
      actions: [],
      revenueLeaks: [],
      risks: [],
      messages: [],
    };

    profiles.set(cleanName, profile);
    return profile;
  }

  for (const action of workspace.actions) {
    const profile = ensureProfile(action.customer);
    profile.actions.push(action);
    profile.lifetimeValue = Math.max(profile.lifetimeValue, action.value);

    if (action.status === "pending") {
      profile.openActionCount += 1;
    }

    if (action.priority === "urgent" && action.status === "pending") {
      profile.urgentActionCount += 1;
    }

    if (action.reasonCodes.some((code) => code.includes("invoice"))) {
      profile.unpaidValue += action.value;
    }

    if (action.reasonCodes.some((code) => code.includes("complaint") || code.includes("churn"))) {
      profile.complaintCount += 1;
    }

    profile.lastSignal = action.age;
    profile.nextMove = action.title;
  }

  for (const leak of workspace.revenueLeaks) {
    const profile = ensureProfile(leak.customer);
    profile.revenueLeaks.push(leak);
    profile.lifetimeValue = Math.max(profile.lifetimeValue, leak.value);
    profile.unpaidValue += leak.issue.toLowerCase().includes("invoice") ? leak.value : 0;
    profile.lastSignal = leak.age;
    profile.nextMove = leak.nextMove;
  }

  for (const risk of workspace.customerRisks) {
    const profile = ensureProfile(risk.name);
    profile.risks.push(risk);
    profile.risk = highestRisk(profile.risk, risk.level);
    profile.lifetimeValue = Math.max(profile.lifetimeValue, risk.value);
    profile.complaintCount += risk.reason.toLowerCase().includes("complaint") ? 1 : 0;
    profile.nextMove = risk.nextMove;
  }

  for (const message of workspace.inboxMessages) {
    const profile = ensureProfile(customerNameFromMessage(message));
    profile.messages.push(message);
    profile.inboxCount += 1;
    profile.lifetimeValue = Math.max(profile.lifetimeValue, message.estimatedValue);
    profile.lastSignal = message.receivedAt;
  }

  for (const impact of workspace.impactEntries) {
    const profile = ensureProfile(impact.customer);
    profile.impactValue += impact.amount;
    profile.lifetimeValue = Math.max(profile.lifetimeValue, impact.amount);
  }

  return [...profiles.values()]
    .map((profile): CustomerProfile => {
      const risk: CustomerProfile["risk"] =
        profile.risk !== "low"
          ? profile.risk
          : profile.urgentActionCount > 0 || profile.complaintCount > 0
            ? "medium"
            : "low";

      return {
        ...profile,
        risk,
      };
    })
    .sort((a, b) => profileScore(b) - profileScore(a));
}

function normalizeCustomerName(name: string) {
  const cleanName = name.trim();
  return cleanName && cleanName.toLowerCase() !== "from"
    ? cleanName
    : "Unknown customer";
}

function customerNameFromMessage(message: InboxMessage) {
  const match = message.body.match(/Customer:\s*([^.\n]+)/u);
  return normalizeCustomerName(match?.[1] ?? message.from.split("@")[0] ?? "Unknown customer");
}

function highestRisk(
  current: CustomerProfile["risk"],
  next: CustomerProfile["risk"],
) {
  const rank = { low: 1, medium: 2, high: 3 };
  return rank[next] > rank[current] ? next : current;
}

function profileScore(profile: CustomerProfile) {
  const riskScore = profile.risk === "high" ? 30000 : profile.risk === "medium" ? 15000 : 0;
  return (
    riskScore +
    profile.lifetimeValue +
    profile.unpaidValue +
    profile.urgentActionCount * 5000 +
    profile.openActionCount * 1000
  );
}

function buildDailyBrief(
  workspace: WorkspaceSnapshot,
  customerProfiles: CustomerProfile[],
): DailyBrief {
  const pending = workspace.actions.filter((action) => action.status === "pending");
  const topActions = [...pending]
    .sort((a, b) => actionScore(b) - actionScore(a))
    .slice(0, 3);
  const topCustomers = customerProfiles
    .filter((profile) => profile.risk !== "low" || profile.openActionCount > 0)
    .slice(0, 3);
  const revenueAtRisk =
    topActions.reduce((sum, action) => sum + action.value, 0) +
    topCustomers.reduce((sum, profile) => sum + profile.unpaidValue, 0);
  const unreadSignals = workspace.inboxMessages.filter(
    (message) => message.status === "unscanned",
  ).length;
  const approvedToday = workspace.approvalEvents.length;
  const nextBestMove =
    topActions[0]?.title ??
    topCustomers[0]?.nextMove ??
    "Import and scan the inbox to find the next operating priority.";
  const headline =
    topActions.length > 0
      ? `${topActions.length} decisions need attention`
      : "No urgent decisions waiting";
  const summary =
    revenueAtRisk > 0
      ? `${currency.format(revenueAtRisk)} is tied to open actions and customer follow-up.`
      : "The workspace is clear; scan connected sources for new signals.";

  return {
    headline,
    summary,
    topActions,
    topCustomers,
    revenueAtRisk,
    unreadSignals,
    approvedToday,
    nextBestMove,
  };
}

function actionScore(action: BusinessAction) {
  const priority = action.priority === "urgent" ? 20000 : action.priority === "normal" ? 8000 : 0;
  return priority + action.value;
}

export function CommandCenter({ authMode, initialWorkspace }: CommandCenterProps) {
  const [workspace, setWorkspace] = useState(initialWorkspace);
  const [view, setView] = useState<View>("brief");
  const [filter, setFilter] = useState<Filter>("all");
  const [toast, setToast] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isScanning, setIsScanning] = useState(false);
  const [isIngesting, setIsIngesting] = useState(false);
  const [isScanningInbox, setIsScanningInbox] = useState(false);
  const [selectedMessageIds, setSelectedMessageIds] = useState<string[]>([]);
  const [manualInput, setManualInput] = useState(sampleInputs[0]);
  const [onboarding, setOnboarding] = useState<OnboardingProfile>({
    businessName: initialWorkspace.businessName,
    ownerName: initialWorkspace.currentUser.fullName,
    niche: initialWorkspace.niche,
    primaryPainPoint: initialWorkspace.primaryPainPoint,
  });
  const [isOnboarding, setIsOnboarding] = useState(false);
  const [settings, setSettings] = useState<OnboardingProfile>({
    businessName: initialWorkspace.businessName,
    ownerName: initialWorkspace.currentUser.fullName,
    niche: initialWorkspace.niche,
    primaryPainPoint: initialWorkspace.primaryPainPoint,
  });
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [isSavingPlan, setIsSavingPlan] = useState(false);
  const [isOpeningPortal, setIsOpeningPortal] = useState(false);
  const [isConnectingGmail, setIsConnectingGmail] = useState(false);
  const [isImportingGmail, setIsImportingGmail] = useState(false);
  const [updatingExecutionId, setUpdatingExecutionId] = useState("");
  const [teamInvite, setTeamInvite] = useState<TeamInvite>({
    email: "",
    fullName: "",
    role: "manager",
  });
  const [lastInviteEmail, setLastInviteEmail] = useState("");
  const [isInviting, setIsInviting] = useState(false);

  const pendingActions = workspace.actions.filter(
    (action) => action.status === "pending",
  );
  const urgentActions = pendingActions.filter(
    (action) => action.priority === "urgent",
  );
  const recoverableRevenue = workspace.revenueLeaks.reduce(
    (sum, leak) => sum + leak.value,
    0,
  );
  const customerRisks = workspace.customerRisks.filter(
    (risk) => risk.level !== "low",
  ).length;
  const approvedActions = workspace.actions.filter(
    (action) => action.status === "approved",
  ).length;
  const recoveredImpact = workspace.impactEntries
    .filter((entry) => entry.category === "recovered_revenue")
    .reduce((sum, entry) => sum + entry.amount, 0);
  const protectedImpact = workspace.impactEntries
    .filter((entry) => entry.category === "protected_revenue")
    .reduce((sum, entry) => sum + entry.amount, 0);
  const invoiceImpact = workspace.impactEntries
    .filter((entry) => entry.category === "invoice_follow_up")
    .reduce((sum, entry) => sum + entry.amount, 0);
  const timeSavedMinutes = workspace.impactEntries.reduce(
    (sum, entry) => sum + entry.timeSavedMinutes,
    0,
  );
  const totalImpact = recoveredImpact + protectedImpact + invoiceImpact;
  const monthlyRoi = totalImpact - workspace.billingPlan.priceMonthly;
  const queuedJobs = workspace.executionJobs.filter(
    (job) => job.status === "queued",
  );
  const completedJobs = workspace.executionJobs.filter(
    (job) => job.status === "completed",
  ).length;
  const customerProfiles = useMemo(
    () => buildCustomerProfiles(workspace),
    [workspace],
  );
  const dailyBrief = useMemo(
    () => buildDailyBrief(workspace, customerProfiles),
    [workspace, customerProfiles],
  );
  const topCustomer = customerProfiles[0];
  const customerValueAtRisk = customerProfiles.reduce(
    (sum, profile) =>
      profile.risk === "low" ? sum : sum + profile.lifetimeValue,
    0,
  );
  const canApproveActions = can(workspace.currentUser.role, "actions:approve");
  const canManageBilling = can(workspace.currentUser.role, "billing:manage");
  const canScanInbox = can(workspace.currentUser.role, "inbox:scan");
  const canCreateIngestions = can(
    workspace.currentUser.role,
    "ingestions:create",
  );
  const canManageSettings = can(workspace.currentUser.role, "settings:manage");
  const canManageTeam = can(workspace.currentUser.role, "team:manage");
  const canResetWorkspace = can(workspace.currentUser.role, "workspace:reset");

  const visibleActions = useMemo(() => {
    if (filter === "urgent") {
      return workspace.actions.filter((action) => action.priority === "urgent");
    }

    if (filter === "pending") {
      return workspace.actions.filter((action) => action.status === "pending");
    }

    return workspace.actions;
  }, [filter, workspace.actions]);

  function notify(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(""), 2600);
  }

  useEffect(() => {
    async function loadWorkspace() {
      try {
        const response = await fetch("/api/workspace");
        if (!response.ok) {
          throw new Error("Workspace load failed");
        }

        const result = (await response.json()) as {
          workspace: WorkspaceSnapshot;
        };
        setWorkspace(result.workspace);
      } catch {
        notify("Using bundled demo data because the workspace could not load.");
      } finally {
        setIsLoading(false);
      }
    }

    void loadWorkspace();
  }, []);

  async function updateActionStatus(
    id: string,
    status: Extract<ActionStatus, "approved" | "dismissed">,
  ) {
    try {
      const response = await fetch(`/api/actions/${id}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });

      if (!response.ok) {
        throw new Error("Action update failed");
      }

      const result = (await response.json()) as {
        workspace: WorkspaceSnapshot;
      };
      setWorkspace(result.workspace);
      setOnboarding({
        businessName: result.workspace.businessName,
        ownerName: result.workspace.currentUser.fullName,
        niche: result.workspace.niche,
        primaryPainPoint: result.workspace.primaryPainPoint,
      });
      setSettings({
        businessName: result.workspace.businessName,
        ownerName: result.workspace.currentUser.fullName,
        niche: result.workspace.niche,
        primaryPainPoint: result.workspace.primaryPainPoint,
      });

      notify(
        status === "approved"
          ? "Draft approved and queued for sending."
          : "Action dismissed from the queue.",
      );
    } catch {
      notify("Could not save that decision. Try again.");
    }
  }

  async function runScan() {
    setIsScanning(true);

    try {
      const response = await fetch("/api/actions/scan", { method: "POST" });
      if (!response.ok) {
        throw new Error("Scan failed");
      }

      const result = (await response.json()) as {
        action: BusinessAction;
        revenueLeak: WorkspaceSnapshot["revenueLeaks"][number];
        workspace: WorkspaceSnapshot;
      };

      setWorkspace(result.workspace);
      notify("AI scan complete. New revenue recovery action found.");
    } catch {
      notify("Scan failed. Try again in a moment.");
    } finally {
      setIsScanning(false);
    }
  }

  async function resetWorkspace() {
    try {
      const response = await fetch("/api/workspace/reset", { method: "POST" });
      if (!response.ok) {
        throw new Error("Reset failed");
      }

      const result = (await response.json()) as {
        workspace: WorkspaceSnapshot;
      };
      setWorkspace(result.workspace);
      setSettings({
        businessName: result.workspace.businessName,
        ownerName: result.workspace.currentUser.fullName,
        niche: result.workspace.niche,
        primaryPainPoint: result.workspace.primaryPainPoint,
      });
      notify("Demo workspace reset on the backend.");
    } catch {
      notify("Reset failed. Try again.");
    }
  }

  async function classifyManualInput() {
    setIsIngesting(true);

    try {
      const response = await fetch("/api/ingestions/manual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rawText: manualInput }),
      });

      if (!response.ok) {
        throw new Error("Classification failed");
      }

      const result = (await response.json()) as {
        workspace: WorkspaceSnapshot;
      };

      setWorkspace(result.workspace);
      setView("actions");
      notify("Input classified and saved as a pending action.");
    } catch {
      notify("Could not classify that input. Add more detail and try again.");
    } finally {
      setIsIngesting(false);
    }
  }

  function toggleMessage(id: string) {
    setSelectedMessageIds((current) =>
      current.includes(id)
        ? current.filter((messageId) => messageId !== id)
        : [...current, id],
    );
  }

  function selectAllUnscanned() {
    setSelectedMessageIds(
      workspace.inboxMessages
        .filter((message) => message.status === "unscanned")
        .map((message) => message.id),
    );
  }

  async function scanSelectedInboxMessages() {
    setIsScanningInbox(true);

    try {
      const response = await fetch("/api/inbox/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messageIds: selectedMessageIds }),
      });

      if (!response.ok) {
        throw new Error("Inbox scan failed");
      }

      const result = (await response.json()) as {
        scanned: number;
        workspace: WorkspaceSnapshot;
      };

      setWorkspace(result.workspace);
      setSelectedMessageIds([]);
      setView("actions");
      notify(`${result.scanned} Gmail message${result.scanned === 1 ? "" : "s"} scanned into actions.`);
    } catch {
      notify("Could not scan those inbox messages. Select at least one unscanned message.");
    } finally {
      setIsScanningInbox(false);
    }
  }

  async function submitOnboarding() {
    setIsOnboarding(true);

    try {
      const response = await fetch("/api/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(onboarding),
      });

      if (!response.ok) {
        throw new Error("Onboarding failed");
      }

      const result = (await response.json()) as {
        workspace: WorkspaceSnapshot;
      };

      setWorkspace(result.workspace);
      setSettings({
        businessName: result.workspace.businessName,
        ownerName: result.workspace.currentUser.fullName,
        niche: result.workspace.niche,
        primaryPainPoint: result.workspace.primaryPainPoint,
      });
      setView("inbox");
      notify("Workspace created. Your inbox simulator is ready.");
    } catch {
      notify("Could not create the workspace. Check the fields and try again.");
    } finally {
      setIsOnboarding(false);
    }
  }

  async function saveSettings() {
    setIsSavingSettings(true);

    try {
      const response = await fetch("/api/workspace/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });

      if (!response.ok) {
        throw new Error("Settings update failed");
      }

      const result = (await response.json()) as {
        workspace: WorkspaceSnapshot;
      };

      setWorkspace(result.workspace);
      setOnboarding({
        businessName: result.workspace.businessName,
        ownerName: result.workspace.currentUser.fullName,
        niche: result.workspace.niche,
        primaryPainPoint: result.workspace.primaryPainPoint,
      });
      notify("Workspace settings saved.");
    } catch {
      notify("Could not save settings. Check the fields and try again.");
    } finally {
      setIsSavingSettings(false);
    }
  }

  async function updatePlan(planId: BillingPlan["id"]) {
    setIsSavingPlan(true);

    try {
      const response = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planId }),
      });

      if (!response.ok) {
        throw new Error("Plan update failed");
      }

      const result = (await response.json()) as {
        mode: "demo" | "stripe";
        url?: string;
        workspace?: WorkspaceSnapshot;
      };

      if (result.mode === "stripe" && result.url) {
        window.location.assign(result.url);
        return;
      }

      if (!result.workspace) {
        throw new Error("Plan update failed");
      }

      setWorkspace(result.workspace);
      notify(`${result.workspace.billingPlan.name} plan selected.`);
    } catch {
      notify("Could not update billing plan. Try again.");
    } finally {
      setIsSavingPlan(false);
    }
  }

  async function openBillingPortal() {
    setIsOpeningPortal(true);

    try {
      const response = await fetch("/api/billing/portal", {
        method: "POST",
      });

      if (!response.ok) {
        throw new Error("Billing portal failed");
      }

      const result = (await response.json()) as { url: string };
      window.location.assign(result.url);
    } catch {
      notify("Billing portal is available after Stripe checkout is configured.");
    } finally {
      setIsOpeningPortal(false);
    }
  }

  async function inviteTeamMember() {
    setIsInviting(true);

    try {
      const response = await fetch("/api/team/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(teamInvite),
      });

      if (!response.ok) {
        throw new Error("Invite failed");
      }

      const result = (await response.json()) as {
        workspace: WorkspaceSnapshot;
      };

      const invitedEmail = teamInvite.email.trim().toLowerCase();
      setWorkspace(result.workspace);
      setTeamInvite({ email: "", fullName: "", role: "manager" });
      setLastInviteEmail(invitedEmail);
      notify("Invite recorded. The teammate can sign in with that email.");
    } catch {
      notify("Could not invite that team member. Check the fields and try again.");
    } finally {
      setIsInviting(false);
    }
  }

  async function connectGmail() {
    setIsConnectingGmail(true);

    try {
      const response = await fetch("/api/connectors/gmail/connect", {
        method: "POST",
        headers: { Accept: "application/json" },
      });

      if (!response.ok) {
        throw new Error("Gmail connect failed");
      }

      const result = (await response.json()) as {
        authorizationUrl?: string;
        workspace: WorkspaceSnapshot;
      };

      if (result.authorizationUrl) {
        window.location.href = result.authorizationUrl;
        return;
      }

      setWorkspace(result.workspace);
      notify("Gmail connector ready.");
    } catch {
      notify("Could not connect Gmail. Try again.");
    } finally {
      setIsConnectingGmail(false);
    }
  }

  async function importGmailMessages() {
    setIsImportingGmail(true);

    try {
      const response = await fetch("/api/connectors/gmail/import", {
        method: "POST",
      });

      if (!response.ok) {
        throw new Error("Gmail import failed");
      }

      const result = (await response.json()) as {
        imported: number;
        workspace: WorkspaceSnapshot;
      };

      setWorkspace(result.workspace);
      setView("inbox");
      notify(`${result.imported} Gmail messages imported.`);
    } catch {
      notify("Connect Gmail before importing messages.");
    } finally {
      setIsImportingGmail(false);
    }
  }

  async function updateExecutionJobStatus(
    jobId: string,
    status: "completed" | "failed",
  ) {
    setUpdatingExecutionId(jobId);

    try {
      const response = await fetch(`/api/executions/${jobId}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });

      if (!response.ok) {
        throw new Error("Execution update failed");
      }

      const result = (await response.json()) as {
        workspace: WorkspaceSnapshot;
      };

      setWorkspace(result.workspace);
      notify(status === "completed" ? "Execution marked complete." : "Execution marked failed.");
    } catch {
      notify("Could not update execution job.");
    } finally {
      setUpdatingExecutionId("");
    }
  }

  if (!workspace.onboardingCompleted) {
    return (
      <main className="onboarding-shell">
        <section className="onboarding-panel">
          <div>
            <p className="eyebrow">OpsPilot setup</p>
            <h1>Create your business workspace</h1>
            <p>
              Set the tenant profile, then OpsPilot will generate the starter
              inbox, knowledge base, and operations timeline.
            </p>
          </div>

          <div className="onboarding-grid">
            <label>
              <span>Business name</span>
              <input
                onChange={(event) =>
                  setOnboarding((current) => ({
                    ...current,
                    businessName: event.target.value,
                  }))
                }
                value={onboarding.businessName}
              />
            </label>
            <label>
              <span>Owner name</span>
              <input
                onChange={(event) =>
                  setOnboarding((current) => ({
                    ...current,
                    ownerName: event.target.value,
                  }))
                }
                value={onboarding.ownerName}
              />
            </label>
            <label className="span-full">
              <span>Industry or niche</span>
              <input
                onChange={(event) =>
                  setOnboarding((current) => ({
                    ...current,
                    niche: event.target.value,
                  }))
                }
                value={onboarding.niche}
              />
            </label>
          </div>

          <div
            aria-label="Primary operations problem"
            className="pain-grid"
            role="radiogroup"
          >
            {painPointOptions.map((option) => (
              <button
                className={
                  onboarding.primaryPainPoint === option.value ? "active" : ""
                }
                key={option.value}
                onClick={() =>
                  setOnboarding((current) => ({
                    ...current,
                    primaryPainPoint: option.value,
                  }))
                }
                type="button"
              >
                <strong>{option.label}</strong>
                <span>{option.description}</span>
              </button>
            ))}
          </div>

          <button
            className="primary-button"
            disabled={isOnboarding}
            onClick={submitOnboarding}
            type="button"
          >
            {isOnboarding ? "Creating workspace..." : "Create workspace"}
          </button>
        </section>

        <div className={toast ? "toast show" : "toast"} role="status">
          {toast}
        </div>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <aside className="sidebar" aria-label="Primary">
        <div className="brand">
          <div className="brand-mark">OP</div>
          <div>
            <strong>OpsPilot</strong>
            <span>{workspace.niche}</span>
          </div>
        </div>

        <nav className="nav">
          <NavButton active={view === "brief"} onClick={() => setView("brief")} index="01">
            Daily Brief
          </NavButton>
          <NavButton active={view === "overview"} onClick={() => setView("overview")} index="02">
            Overview
          </NavButton>
          <NavButton active={view === "inbox"} onClick={() => setView("inbox")} index="03">
            Inbox
          </NavButton>
          <NavButton active={view === "ingest"} onClick={() => setView("ingest")} index="04">
            Ingest
          </NavButton>
          <NavButton active={view === "actions"} onClick={() => setView("actions")} index="05">
            Action Center
          </NavButton>
          <NavButton active={view === "execution"} onClick={() => setView("execution")} index="06">
            Execution
          </NavButton>
          <NavButton active={view === "revenue"} onClick={() => setView("revenue")} index="07">
            Revenue Leaks
          </NavButton>
          <NavButton active={view === "customers"} onClick={() => setView("customers")} index="08">
            Customer Risk
          </NavButton>
          <NavButton active={view === "impact"} onClick={() => setView("impact")} index="09">
            Impact
          </NavButton>
          <NavButton active={view === "knowledge"} onClick={() => setView("knowledge")} index="10">
            Knowledge
          </NavButton>
          <NavButton active={view === "billing"} onClick={() => setView("billing")} index="11">
            Billing
          </NavButton>
          <NavButton active={view === "settings"} onClick={() => setView("settings")} index="12">
            Settings
          </NavButton>
        </nav>

        <div className="connected">
          <p className="eyebrow">Connected data</p>
          {workspace.connectedAccounts.slice(0, 3).map((account) => (
            <span className={account.status === "connected" ? "" : "pending"} key={account.id}>
              {account.provider}
            </span>
          ))}
        </div>
      </aside>

      <section className="main-content">
        <header className="topbar">
          <div>
            <p className="eyebrow">AI operations manager</p>
            <h1>{workspace.businessName}</h1>
            <div className="role-strip">
              <span className="pill">{workspace.currentUser.role}</span>
              <span>{workspace.currentUser.fullName}</span>
            </div>
            <p>
              OpsPilot watches messy business signals and turns them into
              owner-approved actions tied to money, risk, and time.
            </p>
          </div>
          <div className="topbar-actions">
            <button className="primary-button" disabled={isScanning || !canScanInbox} onClick={runScan} type="button">
              {isScanning ? "Scanning..." : "Run AI scan"}
            </button>
            <button className="secondary-button" disabled={!canResetWorkspace} onClick={resetWorkspace} type="button">
              Reset demo
            </button>
            {authMode === "clerk" ? (
              <>
                <UserButton />
                <SignOutButton redirectUrl="/login">
                  <button className="secondary-button" type="button">
                    Log out
                  </button>
                </SignOutButton>
              </>
            ) : (
              <>
                <a className="secondary-button link-button" href="/login">
                  Switch user
                </a>
                <form action="/api/auth/logout" method="post">
                  <button className="secondary-button" type="submit">
                    Log out
                  </button>
                </form>
              </>
            )}
          </div>
        </header>

        {isLoading && <div className="loading-strip">Loading saved workspace...</div>}

        <section className="metrics" aria-label="Business metrics">
          <Metric label="Recoverable revenue" value={currency.format(recoverableRevenue)} detail="Open leaks found" />
          <Metric label="Urgent actions" value={String(urgentActions.length)} detail="Need approval" />
          <Metric label="Execution queue" value={String(queuedJobs.length)} detail="Approved work" />
          <Metric label="Tracked impact" value={currency.format(totalImpact)} detail={`${approvedActions} approvals`} />
        </section>

        {view === "brief" && (
          <div className="workspace-grid">
            <section className="panel span-2 daily-brief-hero">
              <div>
                <p className="eyebrow">Daily brief</p>
                <h2>{dailyBrief.headline}</h2>
                <p>{dailyBrief.summary}</p>
              </div>
              <div className="brief-scoreboard">
                <Metric
                  detail="Open decision value"
                  label="At stake"
                  value={currency.format(dailyBrief.revenueAtRisk)}
                />
                <Metric
                  detail="Unscanned inbox items"
                  label="Signals"
                  value={String(dailyBrief.unreadSignals)}
                />
                <Metric
                  detail="Audit events"
                  label="Approved"
                  value={String(dailyBrief.approvedToday)}
                />
              </div>
            </section>

            <section className="panel span-2">
              <div className="panel-row">
                <PanelHeading eyebrow="Next best move" title={dailyBrief.nextBestMove} />
                <button
                  className="primary-button"
                  disabled={dailyBrief.topActions.length === 0}
                  onClick={() => setView("actions")}
                  type="button"
                >
                  Review actions
                </button>
              </div>
              <div className="brief-grid">
                {dailyBrief.topActions.length > 0 ? (
                  dailyBrief.topActions.map((action) => (
                    <article className="brief-card" key={action.id}>
                      <div className="tag-row">
                        <span className={`pill ${action.priority}`}>{action.priority}</span>
                        <span className="pill">{currency.format(action.value)}</span>
                        <span className="pill">{action.source}</span>
                      </div>
                      <strong>{action.title}</strong>
                      <p>{action.summary}</p>
                    </article>
                  ))
                ) : (
                  <article className="mini-card">
                    <span className="pill">Clear</span>
                    <strong>No pending actions</strong>
                    <p>Import or scan connected data sources to generate the next brief.</p>
                  </article>
                )}
              </div>
            </section>

            <section className="panel">
              <PanelHeading eyebrow="Customer watchlist" title="Accounts to protect" />
              <div className="stack">
                {dailyBrief.topCustomers.length > 0 ? (
                  dailyBrief.topCustomers.map((profile) => (
                    <article className="mini-card" key={profile.name}>
                      <span className={`pill ${profile.risk}`}>{profile.risk} risk</span>
                      <strong>{profile.name}</strong>
                      <p>{profile.nextMove}</p>
                      <small>{currency.format(profile.lifetimeValue)} value · {profile.openActionCount} open actions</small>
                    </article>
                  ))
                ) : (
                  <article className="mini-card">
                    <span className="pill">Stable</span>
                    <strong>No customer watchlist yet</strong>
                    <p>Customer profiles will appear as signals are imported and scanned.</p>
                  </article>
                )}
              </div>
            </section>
          </div>
        )}

        {view === "overview" && (
          <div className="workspace-grid">
            <section className="panel span-2">
              <PanelHeading eyebrow="Today" title={`${pendingActions.length} actions need approval`} />
              <div className="signal-grid">
                {[
                  ["Inbox triage", "Classifies leads, complaints, invoice issues, and scheduling requests."],
                  ["Revenue recovery", "Finds unpaid invoices, stale quotes, missed leads, and renewals."],
                  ["Customer protection", "Detects complaints and churn signals before the account is lost."],
                  ["Knowledge memory", "Uses policies and notes to create drafts that match the business."],
                ].map(([title, body]) => (
                  <article className="signal-card" key={title}>
                    <strong>{title}</strong>
                    <p>{body}</p>
                  </article>
                ))}
              </div>
            </section>

            <section className="panel">
              <PanelHeading eyebrow="Audit" title="Recent decisions" />
              <div className="stack">
                {workspace.approvalEvents.length > 0 ? (
                  workspace.approvalEvents.slice(0, 4).map((event) => (
                    <article className="mini-card" key={event.id}>
                      <span className={`pill ${event.decision}`}>{event.decision}</span>
                      <strong>{event.actionTitle}</strong>
                      <p>{event.actor} · {formatDateTime(event.createdAt)}</p>
                    </article>
                  ))
                ) : (
                  <article className="mini-card">
                    <span className="pill">Waiting</span>
                    <strong>No approval history yet</strong>
                    <p>Approve or dismiss an action to create the first audit event.</p>
                  </article>
                )}
              </div>
            </section>

            <section className="panel">
              <PanelHeading eyebrow="Timeline" title="Deadlines" />
              <div className="stack">
                {workspace.timeline.map((event) => (
                  <article className="mini-card" key={event.id}>
                    <span className={`pill ${event.risk}`}>{event.risk}</span>
                    <strong>{event.title}</strong>
                    <p>{event.time} · {event.owner}</p>
                  </article>
                ))}
              </div>
            </section>
          </div>
        )}

        {view === "inbox" && (
          <div className="workspace-grid">
            <section className="panel span-2">
              <div className="panel-row">
                <PanelHeading eyebrow="Gmail simulator" title="Select business messages to scan" />
                <div className="form-actions">
                  <button
                    className="secondary-button"
                    disabled={!canScanInbox}
                    onClick={selectAllUnscanned}
                    type="button"
                  >
                    Select unscanned
                  </button>
                  <button
                    className="primary-button"
                    disabled={isScanningInbox || selectedMessageIds.length === 0 || !canScanInbox}
                    onClick={scanSelectedInboxMessages}
                    type="button"
                  >
                    {isScanningInbox ? "Scanning..." : `Scan selected (${selectedMessageIds.length})`}
                  </button>
                </div>
              </div>
              <div className="inbox-list">
                {workspace.inboxMessages.map((message) => (
                  <InboxMessageCard
                    checked={selectedMessageIds.includes(message.id)}
                    key={message.id}
                    message={message}
                    onToggle={() => toggleMessage(message.id)}
                  />
                ))}
              </div>
            </section>

            <section className="panel">
              <PanelHeading eyebrow="Connector shape" title="Gmail import path" />
              <div className="stack">
                <article className="mini-card">
                  <span className="pill">Mock</span>
                  <strong>Inbox payload</strong>
                  <p>Each message includes sender, subject, preview, body, value, and scan status.</p>
                </article>
                <article className="mini-card">
                  <span className="pill">Shared</span>
                  <strong>Ingestion pipeline</strong>
                  <p>Selected messages use the same classifier and repository flow as manual paste.</p>
                </article>
                <article className="mini-card">
                  <span className="pill">Later</span>
                  <strong>OAuth connector</strong>
                  <p>Real Gmail can replace the mock message list without changing the action queue.</p>
                </article>
              </div>
            </section>
          </div>
        )}

        {view === "ingest" && (
          <div className="workspace-grid">
            <section className="panel span-2">
              <PanelHeading eyebrow="Manual ingest" title="Paste a customer message, invoice note, or booking issue" />
              <div className="ingest-layout">
                <div className="ingest-editor">
                  <textarea
                    aria-label="Manual business input"
                    onChange={(event) => setManualInput(event.target.value)}
                    value={manualInput}
                  />
                  <div className="form-actions">
                    <button
                      className="primary-button"
                      disabled={isIngesting || !canCreateIngestions}
                      onClick={classifyManualInput}
                      type="button"
                    >
                      {isIngesting ? "Classifying..." : "Classify input"}
                    </button>
                    <button
                      className="secondary-button"
                      onClick={() => setManualInput(sampleInputs[1])}
                      type="button"
                    >
                      Use complaint
                    </button>
                    <button
                      className="secondary-button"
                      onClick={() => setManualInput(sampleInputs[2])}
                      type="button"
                    >
                      Use invoice
                    </button>
                  </div>
                </div>
                <div className="ingest-preview">
                  <article className="mini-card">
                    <span className="pill">Pipeline</span>
                    <strong>Manual paste</strong>
                    <p>Classifies text into a saved action, revenue leak, or customer risk.</p>
                  </article>
                  <article className="mini-card">
                    <span className="pill">Next</span>
                    <strong>Gmail import</strong>
                    <p>The same API shape can accept real email payloads later.</p>
                  </article>
                </div>
              </div>
            </section>

            <section className="panel">
              <PanelHeading eyebrow="Recent inputs" title="Ingested signals" />
              <div className="stack">
                {workspace.ingestions.length > 0 ? (
                  workspace.ingestions.slice(0, 5).map((ingestion) => (
                    <article className="mini-card" key={ingestion.id}>
                      <span className="pill">{ingestion.detectedCategory}</span>
                      <span className="pill">{ingestion.classifier}</span>
                      <strong>{ingestion.source}</strong>
                      <p>{ingestion.summary}</p>
                    </article>
                  ))
                ) : (
                  <article className="mini-card">
                    <span className="pill">Empty</span>
                    <strong>No manual inputs yet</strong>
                    <p>Classify one pasted message to create the first ingestion record.</p>
                  </article>
                )}
              </div>
            </section>
          </div>
        )}

        {view === "actions" && (
          <section className="panel">
            <div className="panel-row">
              <PanelHeading eyebrow="Action center" title="AI-found work that needs a decision" />
              <div className="segments">
                {(["all", "urgent", "pending"] as const).map((item) => (
                  <button
                    className={filter === item ? "active" : ""}
                    key={item}
                    onClick={() => setFilter(item)}
                    type="button"
                  >
                    {item}
                  </button>
                ))}
              </div>
            </div>
            <div className="action-list">
              {visibleActions.map((action) => (
                <article className="action-card" key={action.id}>
                  <div>
                    <div className="tag-row">
                      <span className={`pill ${action.priority}`}>{action.priority}</span>
                      <span className="pill">{action.source}</span>
                      <span className="pill">{currency.format(action.value)}</span>
                      <span className="pill">{action.status}</span>
                    </div>
                    <h2>{action.title}</h2>
                    <p>{action.summary}</p>
                    <blockquote>{action.draft}</blockquote>
                    <div className="tag-row">
                      {action.reasonCodes.map((code) => (
                        <span className="reason" key={code}>{code}</span>
                      ))}
                    </div>
                  </div>
                  <div className="action-buttons">
                    <button
                      disabled={!canApproveActions || action.status !== "pending"}
                      onClick={() => updateActionStatus(action.id, "approved")}
                      type="button"
                    >
                      Approve
                    </button>
                    <button
                      disabled={!canApproveActions || action.status !== "pending"}
                      onClick={() => updateActionStatus(action.id, "dismissed")}
                      type="button"
                    >
                      Dismiss
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </section>
        )}

        {view === "execution" && (
          <div className="workspace-grid">
            <section className="panel span-2">
              <PanelHeading eyebrow="Execution queue" title="Approved work waiting to be carried out" />
              <div className="billing-summary">
                <Metric
                  detail="Waiting for follow-through"
                  label="Queued"
                  value={String(queuedJobs.length)}
                />
                <Metric
                  detail="Completed jobs"
                  label="Completed"
                  value={String(completedJobs)}
                />
                <Metric
                  detail="Total execution records"
                  label="All jobs"
                  value={String(workspace.executionJobs.length)}
                />
                <Metric
                  detail="Approved actions"
                  label="Approvals"
                  value={String(approvedActions)}
                />
              </div>
            </section>

            <section className="panel span-2">
              <div className="execution-list">
                {workspace.executionJobs.length > 0 ? (
                  workspace.executionJobs.map((job) => (
                    <article className="execution-card" key={job.id}>
                      <div>
                        <div className="tag-row">
                          <span className={`pill ${job.status}`}>{job.status}</span>
                          <span className="pill">{job.type.replaceAll("_", " ")}</span>
                          <span className="pill">{job.customer}</span>
                        </div>
                        <strong>{job.actionTitle}</strong>
                        <p>{job.detail}</p>
                        <small>
                          Owner: {job.owner} · Updated {formatDateTime(job.updatedAt)}
                        </small>
                      </div>
                      <div className="execution-actions">
                        <button
                          disabled={
                            job.status !== "queued" ||
                            updatingExecutionId === job.id ||
                            !canApproveActions
                          }
                          onClick={() => updateExecutionJobStatus(job.id, "completed")}
                          type="button"
                        >
                          Complete
                        </button>
                        <button
                          disabled={
                            job.status !== "queued" ||
                            updatingExecutionId === job.id ||
                            !canApproveActions
                          }
                          onClick={() => updateExecutionJobStatus(job.id, "failed")}
                          type="button"
                        >
                          Fail
                        </button>
                      </div>
                    </article>
                  ))
                ) : (
                  <article className="mini-card">
                    <span className="pill">Empty</span>
                    <strong>No execution jobs yet</strong>
                    <p>Approve an action to create the first queued workflow.</p>
                  </article>
                )}
              </div>
            </section>
          </div>
        )}

        {view === "revenue" && (
          <section className="panel">
            <PanelHeading eyebrow="Revenue leaks" title="Money the business may already be losing" />
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Source</th>
                    <th>Customer</th>
                    <th>Issue</th>
                    <th>Value</th>
                    <th>Next move</th>
                  </tr>
                </thead>
                <tbody>
                  {workspace.revenueLeaks.map((leak) => (
                    <tr key={leak.id}>
                      <td>{leak.source}</td>
                      <td>{leak.customer}</td>
                      <td>{leak.issue}<br /><small>{leak.age}</small></td>
                      <td>{currency.format(leak.value)}</td>
                      <td>{leak.nextMove}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {view === "customers" && (
          <div className="workspace-grid">
            <section className="panel span-2">
              <PanelHeading eyebrow="Customer intelligence" title="Accounts ranked by value, risk, and next move" />
              <div className="billing-summary">
                <Metric
                  detail="Known accounts"
                  label="Customers"
                  value={String(customerProfiles.length)}
                />
                <Metric
                  detail="Medium/high risk value"
                  label="At risk"
                  value={currency.format(customerValueAtRisk)}
                />
                <Metric
                  detail="Open customer work"
                  label="Actions"
                  value={String(customerProfiles.reduce((sum, profile) => sum + profile.openActionCount, 0))}
                />
                <Metric
                  detail={topCustomer ? topCustomer.name : "No account yet"}
                  label="Top priority"
                  value={topCustomer ? topCustomer.risk : "none"}
                />
              </div>
            </section>

            <section className="panel span-2">
              <div className="customer-profile-grid">
                {customerProfiles.length > 0 ? (
                  customerProfiles.map((profile) => (
                    <article className={`customer-profile ${profile.risk}`} key={profile.name}>
                      <div className="customer-profile-head">
                        <div>
                          <span className={`pill ${profile.risk}`}>{profile.risk} risk</span>
                          <h2>{profile.name}</h2>
                          <p>{profile.nextMove}</p>
                        </div>
                        <strong>{currency.format(profile.lifetimeValue)}</strong>
                      </div>

                      <div className="customer-mini-metrics">
                        <span>{profile.openActionCount} open actions</span>
                        <span>{currency.format(profile.unpaidValue)} unpaid/follow-up</span>
                        <span>{profile.complaintCount} complaints</span>
                        <span>{currency.format(profile.impactValue)} impact</span>
                      </div>

                      <div className="customer-history">
                        {profile.actions.slice(0, 2).map((action) => (
                          <div key={action.id}>
                            <span className={`pill ${action.priority}`}>{action.status}</span>
                            <p>{action.title}</p>
                          </div>
                        ))}
                        {profile.risks.slice(0, 1).map((risk) => (
                          <div key={risk.id}>
                            <span className={`pill ${risk.level}`}>risk</span>
                            <p>{risk.reason}</p>
                          </div>
                        ))}
                        {profile.messages.slice(0, 1).map((message) => (
                          <div key={message.id}>
                            <span className={`pill ${message.status}`}>message</span>
                            <p>{message.subject}</p>
                          </div>
                        ))}
                      </div>

                      <small>Last signal: {profile.lastSignal}</small>
                    </article>
                  ))
                ) : (
                  <article className="mini-card">
                    <span className="pill">Waiting</span>
                    <strong>No customer profiles yet</strong>
                    <p>Import and scan inbox messages to build account intelligence.</p>
                  </article>
                )}
              </div>
            </section>
          </div>
        )}

        {view === "impact" && (
          <div className="workspace-grid">
            <section className="panel span-2">
              <PanelHeading eyebrow="Impact ledger" title="Business value created by approved actions" />
              <div className="billing-summary">
                <Metric
                  detail="Approved revenue actions"
                  label="Recovered"
                  value={currency.format(recoveredImpact)}
                />
                <Metric
                  detail="Churn-risk interventions"
                  label="Protected"
                  value={currency.format(protectedImpact)}
                />
                <Metric
                  detail="Payment follow-ups"
                  label="Invoices"
                  value={currency.format(invoiceImpact)}
                />
                <Metric
                  detail="Estimated operations time"
                  label="Time saved"
                  value={`${Math.round(timeSavedMinutes / 60)}h`}
                />
              </div>
            </section>

            <section className="panel span-2">
              <PanelHeading eyebrow="Proof" title="Approved work tied to money" />
              <div className="impact-list">
                {workspace.impactEntries.length > 0 ? (
                  workspace.impactEntries.map((entry) => (
                    <article className="impact-card" key={entry.id}>
                      <div>
                        <div className="tag-row">
                          <span className="pill">{entry.category.replaceAll("_", " ")}</span>
                          <span className="pill">{entry.confidence}</span>
                          <span className="pill">{entry.source}</span>
                        </div>
                        <strong>{entry.actionTitle}</strong>
                        <p>{entry.note}</p>
                        <small>{entry.customer} · {formatDateTime(entry.createdAt)}</small>
                      </div>
                      <div className="impact-value">
                        <strong>{currency.format(entry.amount)}</strong>
                        <span>{entry.timeSavedMinutes} min saved</span>
                      </div>
                    </article>
                  ))
                ) : (
                  <article className="mini-card">
                    <span className="pill">Waiting</span>
                    <strong>No impact recorded yet</strong>
                    <p>Approve actions from the Action Center to build the ROI ledger.</p>
                  </article>
                )}
              </div>
            </section>

            <section className="panel">
              <PanelHeading eyebrow="ROI" title="Subscription payback" />
              <div className="stack">
                <article className="mini-card">
                  <span className="pill">Total</span>
                  <strong>{currency.format(totalImpact)}</strong>
                  <p>Estimated business value tied to approved OpsPilot actions.</p>
                </article>
                <article className="mini-card">
                  <span className="pill">Net</span>
                  <strong>{currency.format(monthlyRoi)}</strong>
                  <p>Tracked impact minus the current monthly plan price.</p>
                </article>
              </div>
            </section>
          </div>
        )}

        {view === "knowledge" && (
          <section className="panel">
            <PanelHeading eyebrow="Knowledge base" title="Business rules for better AI actions" />
            <div className="signal-grid">
              {workspace.knowledgeDocuments.map((document) => (
                <article className="signal-card" key={document.id}>
                  <span className="pill">{document.type}</span>
                  <strong>{document.title}</strong>
                  <p>{document.body}</p>
                </article>
              ))}
            </div>
          </section>
        )}

        {view === "billing" && (
          <div className="workspace-grid">
            <section className="panel span-2">
              <PanelHeading eyebrow="Billing" title="Plan and usage" />
              <div className="billing-summary">
                <Metric
                  detail="Current plan"
                  label="Plan"
                  value={workspace.billingPlan.name}
                />
                <Metric
                  detail={`${workspace.billingPlan.actionLimit} included`}
                  label="Actions used"
                  value={String(workspace.actions.length)}
                />
                <Metric
                  detail={`${workspace.billingPlan.inboxScanLimit} included`}
                  label="Inbox scans"
                  value={String(workspace.ingestions.filter((item) => item.source === "Gmail").length)}
                />
                <Metric
                  detail="Open revenue leaks"
                  label="Potential recovery"
                  value={currency.format(recoverableRevenue)}
                />
              </div>
              <div className="billing-actions">
                <button
                  className="secondary-button"
                  disabled={isOpeningPortal || !canManageBilling}
                  onClick={openBillingPortal}
                  type="button"
                >
                  {isOpeningPortal ? "Opening..." : "Manage billing"}
                </button>
                <p>Stripe Checkout and Customer Portal are used when Stripe keys are configured.</p>
              </div>
            </section>

            <section className="panel span-2">
              <PanelHeading eyebrow="Plans" title="Choose a SaaS tier" />
              <div className="plan-grid">
                {billingPlans.map((plan) => (
                  <article
                    className={
                      workspace.billingPlan.id === plan.id
                        ? "plan-card active"
                        : "plan-card"
                    }
                    key={plan.id}
                  >
                    <span className="pill">{plan.name}</span>
                    <strong>{currency.format(plan.priceMonthly)}/mo</strong>
                    <p>{plan.actionLimit} AI actions and {plan.inboxScanLimit} inbox scans per month.</p>
                    <button
                      className={
                        workspace.billingPlan.id === plan.id
                          ? "secondary-button"
                          : "primary-button"
                      }
                      disabled={
                        isSavingPlan ||
                        workspace.billingPlan.id === plan.id ||
                        !canManageBilling
                      }
                      onClick={() => updatePlan(plan.id)}
                      type="button"
                    >
                      {workspace.billingPlan.id === plan.id ? "Current plan" : "Select plan"}
                    </button>
                  </article>
                ))}
              </div>
            </section>

            <section className="panel">
              <PanelHeading eyebrow="ROI" title="Value signal" />
              <div className="stack">
                <article className="mini-card">
                  <span className="pill">Recovered</span>
                  <strong>{approvedActions} approved actions</strong>
                  <p>Approved actions are the first proof that the owner is acting on OpsPilot recommendations.</p>
                </article>
                <article className="mini-card">
                  <span className="pill">Payback</span>
                  <strong>{currency.format(Math.max(0, recoverableRevenue - workspace.billingPlan.priceMonthly))}</strong>
                  <p>Potential recovery minus the selected monthly plan price.</p>
                </article>
              </div>
            </section>
          </div>
        )}

        {view === "settings" && (
          <div className="workspace-grid">
            <section className="panel span-2">
              <PanelHeading eyebrow="Workspace" title="Business profile" />
              <div className="settings-form">
                <label>
                  <span>Business name</span>
                  <input
                    disabled={!canManageSettings}
                    onChange={(event) =>
                      setSettings((current) => ({
                        ...current,
                        businessName: event.target.value,
                      }))
                    }
                    value={settings.businessName}
                  />
                </label>
                <label>
                  <span>Owner name</span>
                  <input
                    disabled={!canManageSettings}
                    onChange={(event) =>
                      setSettings((current) => ({
                        ...current,
                        ownerName: event.target.value,
                      }))
                    }
                    value={settings.ownerName}
                  />
                </label>
                <label className="span-full">
                  <span>Industry or niche</span>
                  <input
                    disabled={!canManageSettings}
                    onChange={(event) =>
                      setSettings((current) => ({
                        ...current,
                        niche: event.target.value,
                      }))
                    }
                    value={settings.niche}
                  />
                </label>
              </div>
              <div className="pain-grid compact">
                {painPointOptions.map((option) => (
                  <button
                    className={
                      settings.primaryPainPoint === option.value ? "active" : ""
                    }
                    disabled={!canManageSettings}
                    key={option.value}
                    onClick={() =>
                      setSettings((current) => ({
                        ...current,
                        primaryPainPoint: option.value,
                      }))
                    }
                    type="button"
                  >
                    <strong>{option.label}</strong>
                    <span>{option.description}</span>
                  </button>
                ))}
              </div>
              <div className="form-actions">
                <button
                  className="primary-button"
                  disabled={isSavingSettings || !canManageSettings}
                  onClick={saveSettings}
                  type="button"
                >
                  {isSavingSettings ? "Saving..." : "Save settings"}
                </button>
                <button
                  className="secondary-button"
                  disabled={!canResetWorkspace}
                  onClick={resetWorkspace}
                  type="button"
                >
                  Reset workspace
                </button>
              </div>
            </section>

            <section className="panel">
              <PanelHeading eyebrow="AI mode" title="Classifier status" />
              <div className="stack">
                <article className="mini-card">
                  <span className="pill">{workspace.ingestions[0]?.classifier ?? "rules"}</span>
                  <strong>Current classifier</strong>
                  <p>Rules mode is free locally. OpenAI mode is enabled only through environment variables.</p>
                </article>
                <article className="mini-card">
                  <span className="pill">Safe default</span>
                  <strong>No automatic sends</strong>
                  <p>Generated replies stay in the approval queue until an owner approves them.</p>
                </article>
              </div>
            </section>

            <section className="panel span-2">
              <PanelHeading eyebrow="Team" title="Access and roles" />
              <p className="panel-copy">
                Invite a teammate by email. When they sign in through Clerk with the same address,
                OpsPilot activates the invite and applies the recorded role.
              </p>
              <div className="team-layout">
                <div className="team-list">
                  {workspace.teamMembers.map((member) => (
                    <article className="team-card" key={member.id}>
                      <div>
                        <strong>{member.fullName}</strong>
                        <p>{member.email}</p>
                      </div>
                      <div className="tag-row">
                        <span className="pill">{member.role}</span>
                        <span className={`pill ${member.status}`}>{member.status}</span>
                      </div>
                    </article>
                  ))}
                </div>
                <div className="invite-form">
                  {lastInviteEmail ? (
                    <div className="invite-notice">
                      <span className="pill">Ready</span>
                      <strong>{lastInviteEmail}</strong>
                      <p>Ask this teammate to sign in at /login using this email address.</p>
                    </div>
                  ) : null}
                  <label>
                    <span>Full name</span>
                    <input
                      disabled={!canManageTeam}
                      onChange={(event) =>
                        setTeamInvite((current) => ({
                          ...current,
                          fullName: event.target.value,
                        }))
                      }
                      value={teamInvite.fullName}
                    />
                  </label>
                  <label>
                    <span>Email</span>
                    <input
                      disabled={!canManageTeam}
                      onChange={(event) =>
                        setTeamInvite((current) => ({
                          ...current,
                          email: event.target.value,
                        }))
                      }
                      value={teamInvite.email}
                    />
                  </label>
                  <label>
                    <span>Role</span>
                    <select
                      disabled={!canManageTeam}
                      onChange={(event) =>
                        setTeamInvite((current) => ({
                          ...current,
                          role: event.target.value as TeamInvite["role"],
                        }))
                      }
                      value={teamInvite.role}
                    >
                      <option value="manager">Manager</option>
                      <option value="staff">Staff</option>
                    </select>
                  </label>
                  <button
                    className="primary-button"
                    disabled={isInviting || !canManageTeam}
                    onClick={inviteTeamMember}
                    type="button"
                  >
                    {isInviting ? "Inviting..." : "Invite teammate"}
                  </button>
                </div>
              </div>
            </section>

            <section className="panel span-2">
              <PanelHeading eyebrow="Connectors" title="Data sources" />
              <div className="connector-grid">
                {workspace.connectedAccounts.map((connector) => (
                  <article className="connector-card" key={connector.id}>
                    <span className={`pill ${connector.status}`}>{connector.status}</span>
                    <strong>{connector.provider}</strong>
                    <p>{connector.accountLabel}</p>
                    {connector.message && <p>{connector.message}</p>}
                    {connector.lastImportedAt && (
                      <small>Last import: {formatDateTime(connector.lastImportedAt)}</small>
                    )}
                    {connector.provider === "Gmail" && (
                      <div className="connector-actions">
                        <button
                          className="secondary-button"
                          disabled={isConnectingGmail || !canManageSettings}
                          onClick={connectGmail}
                          type="button"
                        >
                          {isConnectingGmail ? "Connecting..." : "Connect"}
                        </button>
                        <button
                          className="primary-button"
                          disabled={
                            isImportingGmail ||
                            !canScanInbox ||
                            connector.status !== "connected"
                          }
                          onClick={importGmailMessages}
                          type="button"
                        >
                          {isImportingGmail ? "Importing..." : "Import"}
                        </button>
                      </div>
                    )}
                  </article>
                ))}
              </div>
            </section>
          </div>
        )}
      </section>

      <div className={toast ? "toast show" : "toast"} role="status">
        {toast}
      </div>
    </main>
  );
}

const sampleInputs = [
  "Customer: Oakfield Homes. We need a quote for a deep clean this Friday. Budget is £1,800 and we may want monthly service after this.",
  "Customer: GreenDesk Studio. This is the second time bins were missed and the team is unhappy. If it happens again we will cancel the monthly plan worth £2,100.",
  "Customer: Westbridge Offices. Invoice OP-1042 for £920 is overdue and accounts asked for the payment link again.",
];

const painPointOptions: Array<{
  value: PainPoint;
  label: string;
  description: string;
}> = [
  {
    value: "missed_leads",
    label: "Missed leads",
    description: "Quote requests and prospects waiting for replies.",
  },
  {
    value: "overdue_invoices",
    label: "Overdue invoices",
    description: "Late payments and billing follow-up.",
  },
  {
    value: "customer_complaints",
    label: "Customer complaints",
    description: "Churn risk, angry messages, and service issues.",
  },
  {
    value: "scheduling",
    label: "Scheduling",
    description: "Bookings, access instructions, and renewals.",
  },
];

function NavButton({
  active,
  children,
  index,
  onClick,
}: {
  active: boolean;
  children: React.ReactNode;
  index: string;
  onClick: () => void;
}) {
  return (
    <button className={active ? "active" : ""} onClick={onClick} type="button">
      <span>{index}</span>
      {children}
    </button>
  );
}

function InboxMessageCard({
  checked,
  message,
  onToggle,
}: {
  checked: boolean;
  message: InboxMessage;
  onToggle: () => void;
}) {
  return (
    <article className={`inbox-card ${message.status}`}>
      <label>
        <input
          checked={checked}
          disabled={message.status === "scanned"}
          onChange={onToggle}
          type="checkbox"
        />
        <span>
          <strong>{message.subject}</strong>
          <small>{message.from} · {message.receivedAt}</small>
        </span>
      </label>
      <p>{message.preview}</p>
      <div className="tag-row">
        <span className={`pill ${message.status}`}>{message.status}</span>
        <span className="pill">{currency.format(message.estimatedValue)}</span>
      </div>
    </article>
  );
}

function Metric({
  detail,
  label,
  value,
}: {
  detail: string;
  label: string;
  value: string;
}) {
  return (
    <article className="metric-card">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </article>
  );
}

function PanelHeading({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <div className="panel-heading">
      <p className="eyebrow">{eyebrow}</p>
      <h2>{title}</h2>
    </div>
  );
}
