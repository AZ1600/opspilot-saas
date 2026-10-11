import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { billingPlans } from "@/lib/billing";
import type { BillingPlan, PainPoint, TeamInvite, WorkspaceSettings } from "@/lib/types";

type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

const painPoints = new Set<PainPoint>([
  "missed_leads", "overdue_invoices", "customer_complaints", "scheduling",
]);

export function badRequest(error: string) {
  return NextResponse.json({ error }, { status: 400 });
}

export async function readJsonObject(
  request: Pick<NextRequest, "json">,
): Promise<ValidationResult<Record<string, unknown>>> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return { ok: false, error: "Request body must be valid JSON." };
  }

  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, error: "Request body must be a JSON object." };
  }
  return { ok: true, value: body as Record<string, unknown> };
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function isPainPoint(value: unknown): value is PainPoint {
  return typeof value === "string" && painPoints.has(value as PainPoint);
}

export function validateWorkspaceProfile(
  body: Record<string, unknown>,
): ValidationResult<WorkspaceSettings> {
  const businessName = text(body.businessName);
  const ownerName = text(body.ownerName);
  const niche = text(body.niche);
  const primaryPainPoint = body.primaryPainPoint;

  if (businessName.length < 2) {
    return { ok: false, error: "Business name is required." };
  }
  if (ownerName.length < 2) {
    return { ok: false, error: "Owner name is required." };
  }
  if (niche.length < 3) {
    return { ok: false, error: "Industry or niche is required." };
  }
  if (!isPainPoint(primaryPainPoint)) {
    return { ok: false, error: "Choose a primary operations problem." };
  }
  return { ok: true, value: { businessName, ownerName, niche, primaryPainPoint } };
}

export function validateTeamInvite(
  body: Record<string, unknown>,
): ValidationResult<TeamInvite> {
  const fullName = text(body.fullName);
  const email = text(body.email);
  const role = body.role;

  if (fullName.length < 2) {
    return { ok: false, error: "Full name is required." };
  }
  if (!email.includes("@")) {
    return { ok: false, error: "Valid email is required." };
  }
  if (role !== "manager" && role !== "staff") {
    return { ok: false, error: "Role must be manager or staff." };
  }
  return { ok: true, value: { fullName, email, role } };
}

export function validateManualInput(
  body: Record<string, unknown>,
): ValidationResult<string> {
  const rawText = text(body.rawText);
  if (rawText.length < 20) {
    return { ok: false, error: "Paste at least 20 characters of business context." };
  }
  return { ok: true, value: rawText };
}

export function validatePlanId(
  body: Record<string, unknown>,
): ValidationResult<BillingPlan["id"]> {
  const plan = billingPlans.find((entry) => entry.id === body.planId);
  if (!plan) {
    return { ok: false, error: "Choose a valid plan." };
  }
  return { ok: true, value: plan.id };
}

export function validateMessageIds(
  body: Record<string, unknown>,
): ValidationResult<string[]> {
  const value = body.messageIds;
  if (!Array.isArray(value) || value.length === 0) {
    return { ok: false, error: "Select at least one inbox message." };
  }
  const ids: string[] = [];
  for (const id of value) {
    if (typeof id !== "string" || id.trim().length === 0) {
      return { ok: false, error: "Message IDs must be non-empty strings." };
    }
    ids.push(id);
  }
  return { ok: true, value: [...new Set(ids)] };
}
