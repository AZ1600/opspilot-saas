import type { BusinessAction, InboxMessage, WorkspaceSnapshot } from "@/lib/types";

export type ClientPermission =
  | "actions:approve"
  | "billing:manage"
  | "inbox:scan"
  | "ingestions:create"
  | "settings:manage"
  | "team:manage"
  | "workspace:reset";

export type CustomerProfile = {
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

export type DailyBrief = {
  headline: string;
  summary: string;
  topActions: WorkspaceSnapshot["actions"];
  topCustomers: CustomerProfile[];
  revenueAtRisk: number;
  unreadSignals: number;
  approvedToday: number;
  nextBestMove: string;
};

export const currency = new Intl.NumberFormat("en-US", {
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

export function can(
  role: WorkspaceSnapshot["currentUser"]["role"],
  permission: ClientPermission,
) {
  return clientPermissions[role].includes(permission);
}

export function formatDateTime(value: string) {
  const date = new Date(value);
  const hours = date.getUTCHours();
  const minutes = date.getUTCMinutes().toString().padStart(2, "0");
  const period = hours >= 12 ? "PM" : "AM";
  const displayHours = hours % 12 || 12;

  return `${monthLabels[date.getUTCMonth()]} ${date.getUTCDate()}, ${date.getUTCFullYear()}, ${displayHours}:${minutes} ${period}`;
}

export function buildCustomerProfiles(workspace: WorkspaceSnapshot): CustomerProfile[] {
  const profiles = new Map<string, CustomerProfile>();

  function ensureProfile(name: string) {
    const cleanName = normalizeCustomerName(name);
    const existing = profiles.get(cleanName);

    if (existing) return existing;

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
    if (action.status === "pending") profile.openActionCount += 1;
    if (action.priority === "urgent" && action.status === "pending") profile.urgentActionCount += 1;
    if (action.reasonCodes.some((code) => code.includes("invoice"))) profile.unpaidValue += action.value;
    if (action.reasonCodes.some((code) => code.includes("complaint") || code.includes("churn"))) profile.complaintCount += 1;
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
    .map((profile): CustomerProfile => ({
      ...profile,
      risk:
        profile.risk !== "low"
          ? profile.risk
          : profile.urgentActionCount > 0 || profile.complaintCount > 0
            ? "medium"
            : "low",
    }))
    .sort((a, b) => profileScore(b) - profileScore(a));
}

export function buildDailyBrief(
  workspace: WorkspaceSnapshot,
  customerProfiles: CustomerProfile[],
): DailyBrief {
  const pending = workspace.actions.filter((action) => action.status === "pending");
  const topActions = [...pending].sort((a, b) => actionScore(b) - actionScore(a)).slice(0, 3);
  const topCustomers = customerProfiles
    .filter((profile) => profile.risk !== "low" || profile.openActionCount > 0)
    .slice(0, 3);
  const revenueAtRisk =
    topActions.reduce((sum, action) => sum + action.value, 0) +
    topCustomers.reduce((sum, profile) => sum + profile.unpaidValue, 0);
  const unreadSignals = workspace.inboxMessages.filter((message) => message.status === "unscanned").length;
  const approvedToday = workspace.approvalEvents.length;
  const nextBestMove =
    topActions[0]?.title ??
    topCustomers[0]?.nextMove ??
    "Import and scan the inbox to find the next operating priority.";

  return {
    headline: topActions.length > 0 ? `${topActions.length} decisions need attention` : "No urgent decisions waiting",
    summary:
      revenueAtRisk > 0
        ? `${currency.format(revenueAtRisk)} is tied to open actions and customer follow-up.`
        : "The workspace is clear; scan connected sources for new signals.",
    topActions,
    topCustomers,
    revenueAtRisk,
    unreadSignals,
    approvedToday,
    nextBestMove,
  };
}

function normalizeCustomerName(name: string) {
  const cleanName = name.trim();
  return cleanName && cleanName.toLowerCase() !== "from" ? cleanName : "Unknown customer";
}

function customerNameFromMessage(message: InboxMessage) {
  const match = message.body.match(/Customer:\s*([^\.\n]+)/u);
  return normalizeCustomerName(match?.[1] ?? message.from.split("@")[0] ?? "Unknown customer");
}

function highestRisk(current: CustomerProfile["risk"], next: CustomerProfile["risk"]) {
  const rank = { low: 1, medium: 2, high: 3 };
  return rank[next] > rank[current] ? next : current;
}

function profileScore(profile: CustomerProfile) {
  const riskScore = profile.risk === "high" ? 30000 : profile.risk === "medium" ? 15000 : 0;
  return riskScore + profile.lifetimeValue + profile.unpaidValue + profile.urgentActionCount * 5000 + profile.openActionCount * 1000;
}

function actionScore(action: BusinessAction) {
  const priority = action.priority === "urgent" ? 20000 : action.priority === "normal" ? 8000 : 0;
  return priority + action.value;
}
