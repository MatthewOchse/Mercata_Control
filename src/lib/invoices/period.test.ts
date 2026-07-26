import { describe, expect, it } from "vitest";
import { dueDateForBillingDay } from "@/lib/billing/cycle";
import { addDaysIso } from "./invariants";
import { periodLabel, yearFromIso } from "./period";

describe("billing period helpers", () => {
  it("labels August 2026 for advance billing copy", () => {
    expect(periodLabel("2026-08-01")).toBe("August 2026");
  });

  it("extracts year for number allocation and storage", () => {
    expect(yearFromIso("2026-08-01")).toBe(2026);
  });

  it("due date offset is issue + N days", () => {
    expect(addDaysIso("2026-08-01", 7)).toBe("2026-08-08");
    expect(addDaysIso("2026-08-01", 14)).toBe("2026-08-15");
    expect(addDaysIso("2026-08-01", 0)).toBe("2026-08-01");
  });

  it("billing day due date uses period month and rolls forward", () => {
    expect(dueDateForBillingDay("2026-07-13", "2026-07-01", 1)).toBe(
      "2026-08-01",
    );
    expect(dueDateForBillingDay("2026-07-13", "2026-07-01", 15)).toBe(
      "2026-07-15",
    );
    expect(dueDateForBillingDay("2026-07-01", "2026-08-01", 1)).toBe(
      "2026-08-01",
    );
  });
});
