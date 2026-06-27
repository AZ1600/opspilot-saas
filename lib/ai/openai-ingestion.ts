import type { IngestionRecord } from "@/lib/types";
import type { IngestionInsert } from "@/lib/server/workspace-repository";
import { classifyInput } from "@/lib/ai/ingestion-engine";

type OpenAIClassification = {
  detectedCategory: IngestionRecord["detectedCategory"];
  customer: string;
  value: number;
  priority: "urgent" | "normal" | "low";
  summary: string;
  actionTitle: string;
  draft: string;
  reasonCodes: string[];
  createRevenueLeak: boolean;
  revenueIssue: string;
  nextMove: string;
  createCustomerRisk: boolean;
  riskLevel: "high" | "medium" | "low";
  riskReason: string;
  riskNextMove: string;
};

const classificationSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "detectedCategory",
    "customer",
    "value",
    "priority",
    "summary",
    "actionTitle",
    "draft",
    "reasonCodes",
    "createRevenueLeak",
    "revenueIssue",
    "nextMove",
    "createCustomerRisk",
    "riskLevel",
    "riskReason",
    "riskNextMove",
  ],
  properties: {
    detectedCategory: {
      type: "string",
      enum: ["lead", "invoice", "complaint", "booking", "general"],
    },
    customer: { type: "string" },
    value: { type: "number" },
    priority: { type: "string", enum: ["urgent", "normal", "low"] },
    summary: { type: "string" },
    actionTitle: { type: "string" },
    draft: { type: "string" },
    reasonCodes: {
      type: "array",
      items: { type: "string" },
      minItems: 1,
      maxItems: 5,
    },
    createRevenueLeak: { type: "boolean" },
    revenueIssue: { type: "string" },
    nextMove: { type: "string" },
    createCustomerRisk: { type: "boolean" },
    riskLevel: { type: "string", enum: ["high", "medium", "low"] },
    riskReason: { type: "string" },
    riskNextMove: { type: "string" },
  },
};

export async function classifyManualInputWithProvider(
  rawText: string,
  source: IngestionRecord["source"] = "Manual paste",
): Promise<IngestionInsert> {
  if (!shouldUseOpenAI()) {
    return classifyInput(rawText, source);
  }

  try {
    return await classifyWithOpenAI(rawText, source);
  } catch (error) {
    console.error("OpenAI ingestion failed. Falling back to rules.", error);
    return classifyInput(rawText, source);
  }
}

function shouldUseOpenAI() {
  return (
    process.env.OPSPILOT_AI_PROVIDER === "openai" &&
    Boolean(process.env.OPENAI_API_KEY)
  );
}

async function classifyWithOpenAI(
  rawText: string,
  source: IngestionRecord["source"],
): Promise<IngestionInsert> {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    return classifyInput(rawText, source);
  }

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL ?? "gpt-4.1-mini",
      instructions:
        "You classify messy small-business operations text for a service company. Return concise, safe, owner-approved workflow data. Never claim a message was sent.",
      input: `Classify this business signal and create the next best owner-approved action:\n\n${rawText}`,
      text: {
        format: {
          type: "json_schema",
          name: "opspilot_ingestion_classification",
          strict: true,
          schema: classificationSchema,
        },
      },
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenAI request failed with ${response.status}`);
  }

  const payload = (await response.json()) as {
    output_text?: string;
    output?: Array<{
      content?: Array<{ type?: string; text?: string }>;
    }>;
  };
  const text =
    payload.output_text ??
    payload.output
      ?.flatMap((item) => item.content ?? [])
      .find((part) => part.type === "output_text")?.text;

  if (!text) {
    throw new Error("OpenAI response did not include output text");
  }

  const classification = JSON.parse(text) as OpenAIClassification;
  return toIngestionInsert(rawText, source, classification);
}

function toIngestionInsert(
  rawText: string,
  source: IngestionRecord["source"],
  classification: OpenAIClassification,
): IngestionInsert {
  const now = Date.now();
  const ingestion: IngestionRecord = {
    id: `ingestion-${now}`,
    source,
    classifier: "openai",
    rawText,
    detectedCategory: classification.detectedCategory,
    summary: classification.summary,
    createdAt: new Date(now).toISOString(),
  };

  const actionId = `act-ingest-${now}`;

  return {
    ingestion,
    actions: [
      {
        id: actionId,
        title: classification.actionTitle,
        source: "Gmail",
        customer: classification.customer,
        value: Math.max(0, Math.round(classification.value)),
        priority: classification.priority,
        status: "pending",
        age: "new",
        summary: classification.summary,
        draft: classification.draft,
        reasonCodes: classification.reasonCodes,
      },
    ],
    revenueLeaks: classification.createRevenueLeak
      ? [
          {
            id: `rev-${actionId}`,
            source: "Manual paste",
            issue: classification.revenueIssue,
            customer: classification.customer,
            value: Math.max(0, Math.round(classification.value)),
            age: "new",
            nextMove: classification.nextMove,
          },
        ]
      : [],
    customerRisks: classification.createCustomerRisk
      ? [
          {
            id: `risk-${now}`,
            name: classification.customer,
            level: classification.riskLevel,
            value: Math.max(0, Math.round(classification.value)),
            reason: classification.riskReason,
            nextMove: classification.riskNextMove,
          },
        ]
      : [],
  };
}
