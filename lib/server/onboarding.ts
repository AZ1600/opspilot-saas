import type { OnboardingProfile, WorkspaceSnapshot, WorkspaceUser } from "@/lib/types";

export class OnboardingAlreadyCompletedError extends Error {
  constructor() {
    super("This workspace is already set up. Use Settings to change its profile.");
    this.name = "OnboardingAlreadyCompletedError";
  }
}
export class OnboardingOwnerError extends Error {
  constructor() {
    super("Onboarding requires an active owner of this business.");
    this.name = "OnboardingOwnerError";
  }
}

export function completeExistingOnboarding(
  workspace: WorkspaceSnapshot,
  profile: OnboardingProfile,
  owner?: WorkspaceUser,
): WorkspaceSnapshot {
  const actor = owner ?? workspace.currentUser;
  const member = workspace.teamMembers.find((entry) =>
    entry.id === actor.id && entry.businessId === workspace.businessId &&
    entry.role === "owner" && entry.status === "active",
  );
  if (!member || actor.businessId !== workspace.businessId || actor.role !== "owner") {
    throw new OnboardingOwnerError();
  }
  const businessName = profile.businessName.trim();
  const niche = profile.niche.trim();
  const ownerName = profile.ownerName.trim();
  if (workspace.onboardingCompleted) {
    if (workspace.businessName === businessName && workspace.niche === niche &&
      workspace.primaryPainPoint === profile.primaryPainPoint && member.fullName === ownerName) {
      return workspace;
    }
    throw new OnboardingAlreadyCompletedError();
  }
  const currentUser: WorkspaceUser = {
    id: member.id, businessId: workspace.businessId,
    email: member.email, fullName: ownerName, role: member.role,
  };
  return {
    ...workspace, businessName, niche, primaryPainPoint: profile.primaryPainPoint,
    onboardingCompleted: true, currentUser,
    teamMembers: workspace.teamMembers.map((entry) =>
      entry.id === member.id ? { ...entry, fullName: ownerName } : entry,
    ),
    knowledgeDocuments: workspace.knowledgeDocuments.map((document) => {
      if (document.id === "doc-001") return { ...document, body: `${ownerName} approves every AI draft before it is sent to a customer.` };
      if (document.id === "doc-002") return { ...document, body: `OpsPilot should prioritize ${profile.primaryPainPoint.replaceAll("_", " ")} for ${businessName}.` };
      return document;
    }),
  };
}
