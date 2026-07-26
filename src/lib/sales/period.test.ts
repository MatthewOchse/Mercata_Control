import { describe, expect, it } from "vitest";
import {
  daysInMonth,
  isMonthClosed,
  previousSastMonth,
  sastMonthFromIso,
  sastMonthOf,
  sastMonthWindow,
} from "@/lib/sales/period";

describe("sastMonthWindow", () => {
  it("covers the whole calendar month in SAST", () => {
    const w = sastMonthWindow(2026, 7);
    expect(w.periodStart).toBe("2026-07-01");
    expect(w.periodEnd).toBe("2026-07-31");
    expect(w.label).toBe("July 2026");
  });

  it("converts SAST midnight to the correct UTC instant", () => {
    // 00:00 on 1 July SAST is 22:00 on 30 June UTC. Sending the bare date
    // "2026-07-01" instead would start the month two hours early.
    const w = sastMonthWindow(2026, 7);
    expect(w.fromInstant).toBe("2026-06-30T22:00:00.000Z");
    expect(w.toInstantExclusive).toBe("2026-07-31T22:00:00.000Z");
  });

  it("rolls the exclusive end into the next year in December", () => {
    const w = sastMonthWindow(2026, 12);
    expect(w.periodEnd).toBe("2026-12-31");
    expect(w.toInstantExclusive).toBe("2026-12-31T22:00:00.000Z");
  });

  it("handles February in a leap year", () => {
    expect(daysInMonth(2028, 2)).toBe(29);
    expect(sastMonthWindow(2028, 2).periodEnd).toBe("2028-02-29");
  });

  it("rejects an impossible month", () => {
    expect(() => sastMonthWindow(2026, 13)).toThrow(/Invalid sales month/);
    expect(() => sastMonthWindow(1999, 1)).toThrow(/Invalid sales year/);
  });
});

describe("previousSastMonth", () => {
  it("steps back within a year", () => {
    expect(previousSastMonth({ year: 2026, month: 8 })).toEqual({
      year: 2026,
      month: 7,
    });
  });

  it("wraps to December of the prior year", () => {
    expect(previousSastMonth({ year: 2026, month: 1 })).toEqual({
      year: 2025,
      month: 12,
    });
  });
});

describe("sastMonthOf", () => {
  it("uses the SAST calendar day, not the UTC one", () => {
    // 22:30 UTC on 31 July is already 00:30 on 1 August in Johannesburg.
    expect(sastMonthOf(new Date("2026-07-31T22:30:00Z"))).toEqual({
      year: 2026,
      month: 8,
    });
    expect(sastMonthOf(new Date("2026-07-31T21:30:00Z"))).toEqual({
      year: 2026,
      month: 7,
    });
  });
});

describe("isMonthClosed", () => {
  const now = new Date("2026-08-05T09:00:00Z");

  it("treats a finished month as closed", () => {
    expect(isMonthClosed({ year: 2026, month: 7 }, now)).toBe(true);
  });

  it("treats the current month as open", () => {
    expect(isMonthClosed({ year: 2026, month: 8 }, now)).toBe(false);
  });

  it("treats a future month as open", () => {
    expect(isMonthClosed({ year: 2026, month: 9 }, now)).toBe(false);
  });
});

describe("sastMonthFromIso", () => {
  it("reads a period start date", () => {
    expect(sastMonthFromIso("2026-08-01")).toEqual({ year: 2026, month: 8 });
  });
});
