import { describe, expect, it } from "vitest";
import { periodLabel, yearFromIso } from "./period";
import { addDaysIso } from "./invariants";

describe("billing period helpers", () => {
  it("labels August 2026 for advance billing copy", () => {
    expect(periodLabel("2026-08-01")).toBe("August 2026");
  });

  it("extracts year for number allocation and storage", () => {
    expect(yearFromIso("2026-08-01")).toBe(2026);
  });

  it("due date is issue + 7 days", () => {
    expect(addDaysIso("2026-08-01", 7)).toBe("2026-08-08");
  });
});
