import { describe, expect, it } from "vitest";
import { classifyManualInput } from "@/lib/ai/ingestion-engine";

describe("classifyManualInput", () => {
  it("turns overdue invoice text into an urgent invoice recovery action", () => {
    const result = classifyManualInput(
      "Client: Blue Peak Dental has an overdue invoice for $2,450 and asked for the payment link today.",
    );

    expect(result.ingestion.detectedCategory).toBe("invoice");
    expect(result.actions).toHaveLength(1);
    expect(result.actions[0]).toMatchObject({
      customer: "Blue Peak Dental",
      priority: "urgent",
      title: "Resolve payment or invoice issue",
      value: 2450,
    });
    expect(result.revenueLeaks[0]).toMatchObject({
      customer: "Blue Peak Dental",
      issue: "Invoice/payment issue needs resolution",
      value: 2450,
    });
    expect(result.customerRisks).toHaveLength(0);
  });

  it("turns complaint text into a customer risk without creating a revenue leak", () => {
    const result = classifyManualInput(
      "Customer: Bright Spa is angry about a missed appointment and may cancel after poor service.",
    );

    expect(result.ingestion.detectedCategory).toBe("complaint");
    expect(result.actions[0]).toMatchObject({
      customer: "Bright Spa",
      priority: "urgent",
      title: "Escalate customer complaint",
    });
    expect(result.revenueLeaks).toHaveLength(0);
    expect(result.customerRisks[0]).toMatchObject({
      level: "high",
      name: "Bright Spa",
    });
  });
});
