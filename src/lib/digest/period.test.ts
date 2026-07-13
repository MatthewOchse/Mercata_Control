import { describe, expect, it } from "vitest";
import {
  addDaysYmd,
  periodsForDigest,
  shouldSendDigestToday,
} from "@/lib/digest/period";

describe("digest periods", () => {
  it("weekly covers prior 7 days ending yesterday", () => {
    const { period, previous } = periodsForDigest("weekly", "2026-07-13");
    expect(period.from).toBe("2026-07-06");
    expect(period.to).toBe("2026-07-12");
    expect(previous.from).toBe("2026-06-29");
    expect(previous.to).toBe("2026-07-05");
  });

  it("daily covers yesterday vs day before", () => {
    const { period, previous } = periodsForDigest("daily", "2026-07-13");
    expect(period.from).toBe("2026-07-12");
    expect(period.to).toBe("2026-07-12");
    expect(previous.from).toBe("2026-07-11");
    expect(previous.to).toBe("2026-07-11");
  });

  it("addDaysYmd crosses months", () => {
    expect(addDaysYmd("2026-07-01", -1)).toBe("2026-06-30");
  });
});

describe("shouldSendDigestToday", () => {
  it("sends weekly only on digest_day", () => {
    // 2026-07-13 is a Monday
    const monday = new Date("2026-07-13T10:00:00+02:00");
    expect(
      shouldSendDigestToday({
        cadence: "weekly",
        digestDay: 1,
        now: monday,
      }),
    ).toBe(true);
    expect(
      shouldSendDigestToday({
        cadence: "weekly",
        digestDay: 2,
        now: monday,
      }),
    ).toBe(false);
  });

  it("never sends when off", () => {
    expect(
      shouldSendDigestToday({ cadence: "off", digestDay: 1 }),
    ).toBe(false);
  });
});
