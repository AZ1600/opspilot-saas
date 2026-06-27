import type {
  BusinessAction,
  CustomerRisk,
  IngestionRecord,
  RevenueLeak,
} from "@/lib/types";
import type { IngestionInsert } from "@/lib/server/workspace-repository";

type Classification = IngestionRecord["detectedCategory"];

export function classifyManualInput(rawText: string): IngestionInsert {
  return classifyInput(rawText, "Manual paste");
}

export function classifyInput(
  rawText: string,
  source: IngestionRecord["source"],
): IngestionInsert {
  const text = rawText.trim();
  const lower = text.toLowerCase();
  const now = Date.now();
  const category = detectCategory(lower);
  const customer = detectCustomer(text);
  const value = detectValue(text, category);
  const summary = createSummary(text, category, customer);

  const ingestion: IngestionRecord = {
    id: `ingestion-${now}`,
    source,
    classifier: "rules",
    rawText: text,
    detectedCategory: category,
    summary,
    createdAt: new Date(now).toISOString(),
  };

  const action = createAction({
    category,
    customer,
    lower,
    now,
    summary,
    value,
  });

  return {
    ingestion,
    actions: [action],
    revenueLeaks: createRevenueLeaks({
      action,
      category,
      customer,
      value,
    }),
    customerRisks: createCustomerRisks({
      category,
      customer,
      lower,
      value,
    }),
  };
}

function detectCategory(lower: string): Classification {
  if (hasAny(lower, ["invoice", "overdue", "payment", "paid", "unpaid"])) {
    return "invoice";
  }

  if (hasAny(lower, ["complaint", "cancel", "unhappy", "angry", "missed", "poor service"])) {
    return "complaint";
  }

  if (hasAny(lower, ["quote", "estimate", "price", "lead", "interested", "book a clean"])) {
    return "lead";
  }

  if (hasAny(lower, ["booking", "appointment", "schedule", "tomorrow", "access"])) {
    return "booking";
  }

  return "general";
}

function detectCustomer(text: string) {
  const companyMatch = text.match(/\b(?:from|customer|client|company):\s*([^.,;\n]+)/i);
  if (companyMatch?.[1]) {
    return companyMatch[1]
      .replace(/\s+(?:has|is|was|wants|asked|needs|sent|said|called|emailed|may|with|for)\b.*$/i, "")
      .trim();
  }

  const nameMatch = text.match(/\b([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+){0,2})\b/);
  return nameMatch?.[1] ?? "Unknown customer";
}

function detectValue(text: string, category: Classification) {
  const moneyMatch = text.match(/(?:\$|£)(\d[\d,]*(?:\.\d{1,2})?)/);
  if (moneyMatch?.[1]) {
    return Number(moneyMatch[1].replaceAll(",", ""));
  }

  if (category === "complaint") return 1800;
  if (category === "invoice") return 950;
  if (category === "lead") return 1500;
  if (category === "booking") return 350;
  return 500;
}

function createSummary(text: string, category: Classification, customer: string) {
  const clipped = text.length > 130 ? `${text.slice(0, 127)}...` : text;

  if (category === "lead") {
    return `${customer} appears to be a sales lead that needs follow-up. ${clipped}`;
  }

  if (category === "invoice") {
    return `${customer} has a payment or invoice issue that may affect cash flow. ${clipped}`;
  }

  if (category === "complaint") {
    return `${customer} shows a customer risk signal that needs owner attention. ${clipped}`;
  }

  if (category === "booking") {
    return `${customer} has a scheduling or access issue that could disrupt service. ${clipped}`;
  }

  return `${customer} was added as a general operations signal. ${clipped}`;
}

function createAction({
  category,
  customer,
  lower,
  now,
  summary,
  value,
}: {
  category: Classification;
  customer: string;
  lower: string;
  now: number;
  summary: string;
  value: number;
}): BusinessAction {
  const urgent =
    category === "complaint" ||
    category === "invoice" ||
    hasAny(lower, ["urgent", "today", "cancel", "overdue"]);

  return {
    id: `act-ingest-${now}`,
    title: titleFor(category),
    source: "Gmail",
    customer,
    value,
    priority: urgent ? "urgent" : "normal",
    status: "pending",
    age: "new",
    summary,
    draft: draftFor(category, customer),
    reasonCodes: reasonCodesFor(category, urgent),
  };
}

function createRevenueLeaks({
  action,
  category,
  customer,
  value,
}: {
  action: BusinessAction;
  category: Classification;
  customer: string;
  value: number;
}): RevenueLeak[] {
  if (!["lead", "invoice", "booking"].includes(category)) {
    return [];
  }

  return [
    {
      id: `rev-${action.id}`,
      source: "Manual paste",
      issue: revenueIssueFor(category),
      customer,
      value,
      age: "new",
      nextMove: action.title,
    },
  ];
}

function createCustomerRisks({
  category,
  customer,
  lower,
  value,
}: {
  category: Classification;
  customer: string;
  lower: string;
  value: number;
}): CustomerRisk[] {
  if (category !== "complaint" && !hasAny(lower, ["cancel", "unhappy", "angry"])) {
    return [];
  }

  return [
    {
      id: `risk-${Date.now()}`,
      name: customer,
      level: hasAny(lower, ["cancel", "angry", "second time", "again"]) ? "high" : "medium",
      value,
      reason: "Manual input contained complaint or churn-risk language.",
      nextMove: "Send owner apology and offer a specific fix today.",
    },
  ];
}

function titleFor(category: Classification) {
  if (category === "lead") return "Follow up with new sales lead";
  if (category === "invoice") return "Resolve payment or invoice issue";
  if (category === "complaint") return "Escalate customer complaint";
  if (category === "booking") return "Confirm booking details";
  return "Review operations signal";
}

function draftFor(category: Classification, customer: string) {
  if (category === "lead") {
    return `Hi ${customer}, thanks for reaching out. I can help with that and send a clear quote today if you confirm the best time and service details.`;
  }

  if (category === "invoice") {
    return `Hi ${customer}, quick note on the invoice/payment item. I can resend the payment link or clarify any line item if needed.`;
  }

  if (category === "complaint") {
    return `Hi ${customer}, I am sorry this happened. I can review it today and put a specific fix in place so it does not repeat.`;
  }

  if (category === "booking") {
    return `Hi ${customer}, confirming the booking details. Could you send the preferred time and any access instructions before the visit?`;
  }

  return `Hi ${customer}, thanks for the update. I am reviewing this and will come back with the next step shortly.`;
}

function reasonCodesFor(category: Classification, urgent: boolean) {
  return [category, urgent ? "urgent signal" : "follow-up due", "manual ingestion"];
}

function revenueIssueFor(category: Classification) {
  if (category === "lead") return "New lead needs follow-up";
  if (category === "invoice") return "Invoice/payment issue needs resolution";
  return "Booking may be at risk";
}

function hasAny(text: string, terms: string[]) {
  return terms.some((term) => text.includes(term));
}
