import { describe, expect, it } from "vitest";
import { commissionCents } from "@/lib/sales/gross-sales";

describe("commissionCents", () => {
  it("charges 2% of gross", () => {
    // R60 000,00 gross → R1 200,00 commission
    expect(commissionCents(6_000_000, 0.02)).toBe(120_000);
  });

  it("returns zero for a flat plan", () => {
    expect(commissionCents(6_000_000, 0)).toBe(0);
  });

  it("returns zero on zero sales rather than throwing", () => {
    expect(commissionCents(0, 0.02)).toBe(0);
  });

  it("rounds the final cent half-up", () => {
    // 1 cent at 2% is 0.02c → rounds down to 0
    expect(commissionCents(1, 0.02)).toBe(0);
    // 25 cents at 2% is 0.5c → rounds up to 1
    expect(commissionCents(25, 0.02)).toBe(1);
    // 24 cents at 2% is 0.48c → rounds down to 0
    expect(commissionCents(24, 0.02)).toBe(0);
  });

  it("stays exact on a large gross with no float drift", () => {
    // R1 234 567,89 at 2% = R24 691,3578 → 2 469 136 cents
    expect(commissionCents(123_456_789, 0.02)).toBe(2_469_136);
  });

  it("handles a four-decimal rate", () => {
    expect(commissionCents(1_000_000, 0.0225)).toBe(22_500);
  });

  it("refuses non-integer cents", () => {
    expect(() => commissionCents(100.5, 0.02)).toThrow(/integer cents/);
  });

  it("refuses a nonsense rate", () => {
    expect(() => commissionCents(1000, 1.5)).toThrow(/Invalid commission rate/);
    expect(() => commissionCents(1000, -0.01)).toThrow(
      /Invalid commission rate/,
    );
  });
});
