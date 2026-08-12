import { describe, expect, it } from "vitest";
import {
  buildCustomerProfiles,
  buildDailyBrief,
  can,
  formatDateTime,
} from "@/lib/command-center-insights";
import { demoWorkspace } from "@/lib/demo-data";

describe("command center insights", () => {
  it("enforces the client permission matrix", () => {
    expect(can("owner", "billing:manage")).toBe(true);
    expect(can("manager", "actions:approve")).toBe(true);
    expect(can("manager", "billing:manage")).toBe(false);
    expect(can("staff", "inbox:scan")).toBe(false);
  });

  it("aggregates customer signals and ranks the highest-risk profile first", () => {
    const profiles = buildCustomerProfiles(demoWorkspace);
    const greenDesk = profiles.find((profile) => profile.name === "GreenDesk Studio");

    expect(profiles[0]?.name).toBe("GreenDesk Studio");
    expect(greenDesk).toMatchObject({
      complaintCount: 2,
      inboxCount: 1,
      lifetimeValue: 2100,
      openActionCount: 1,
      risk: "high",
      urgentActionCount: 1,
    });
    expect(greenDesk?.actions).toHaveLength(1);
    expect(greenDesk?.messages).toHaveLength(1);
    expect(greenDesk?.risks).toHaveLength(1);
  });

  it("builds a brief from pending actions and unread inbox signals", () => {
    const profiles = buildCustomerProfiles(demoWorkspace);
    const brief = buildDailyBrief(demoWorkspace, profiles);

    expect(brief.headline).toBe("3 decisions need attention");
    expect(brief.topActions.map((action) => action.id)).toEqual([
      "act-003",
      "act-001",
      "act-002",
    ]);
    expect(brief.topCustomers[0]?.name).toBe("GreenDesk Studio");
    expect(brief.unreadSignals).toBe(4);
    expect(brief.nextBestMove).toBe("Escalate repeat complaint");
  });

  it("formats timestamps consistently in UTC", () => {
    expect(formatDateTime("2026-08-12T16:05:00.000Z")).toBe(
      "Aug 12, 2026, 4:05 PM",
    );
  });
});
