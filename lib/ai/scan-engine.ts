import type { BusinessAction, RevenueLeak } from "@/lib/types";

type ScanResult = {
  action: BusinessAction;
  revenueLeak: RevenueLeak;
  scannedAt: string;
};

export function createScanResult(): ScanResult {
  const timestamp = Date.now();

  return {
    scannedAt: new Date(timestamp).toISOString(),
    action: {
      id: `act-${timestamp}`,
      title: "Follow up on silent quote",
      source: "Gmail",
      customer: "Sam Patterson",
      value: 1250,
      priority: "normal",
      status: "pending",
      age: "6d",
      summary:
        "A quote was sent last week and the customer opened the email twice without replying.",
      draft:
        "Hi Sam, checking whether you would like us to hold the proposed cleaning slot. I can adjust the quote if your requirements changed.",
      reasonCodes: ["stale quote", "email opened", "follow-up due"],
    },
    revenueLeak: {
      id: `rev-${timestamp}`,
      source: "Gmail",
      issue: "Silent quote opened twice",
      customer: "Sam Patterson",
      value: 1250,
      age: "6 days",
      nextMove: "Send warm follow-up",
    },
  };
}
