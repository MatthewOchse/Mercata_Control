/**
 * Calendar-month windows in Africa/Johannesburg (SAST).
 *
 * SAST is UTC+2 all year — South Africa has never observed daylight saving —
 * so a fixed "+02:00" offset is exact, not an approximation. This matters
 * because tenant storefronts store `stocktrn.trn_at` in UTC and the fleet
 * stats endpoint treats a bare `YYYY-MM-DD` as a *UTC* day boundary. Sending
 * instants instead of date strings is what keeps a "July" total actually
 * equal to July in Johannesburg.
 */

const SAST_OFFSET = "+02:00";

export type SastMonth = { year: number; month: number };

export type SastMonthWindow = {
  year: number;
  /** 1-12 */
  month: number;
  /** Inclusive first calendar day, YYYY-MM-DD */
  periodStart: string;
  /** Inclusive last calendar day, YYYY-MM-DD */
  periodEnd: string;
  /** ISO instant of 00:00:00 SAST on periodStart */
  fromInstant: string;
  /** ISO instant of 00:00:00 SAST on the 1st of the following month (exclusive) */
  toInstantExclusive: string;
  /** e.g. "July 2026" */
  label: string;
};

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function assertMonth(year: number, month: number): void {
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    throw new Error(`Invalid sales year: ${year}`);
  }
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new Error(`Invalid sales month: ${month}`);
  }
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function sastMonthWindow(year: number, month: number): SastMonthWindow {
  assertMonth(year, month);
  const last = daysInMonth(year, month);
  const periodStart = `${year}-${pad2(month)}-01`;
  const periodEnd = `${year}-${pad2(month)}-${pad2(last)}`;

  const next =
    month === 12
      ? { year: year + 1, month: 1 }
      : { year, month: month + 1 };

  return {
    year,
    month,
    periodStart,
    periodEnd,
    fromInstant: new Date(
      `${periodStart}T00:00:00.000${SAST_OFFSET}`,
    ).toISOString(),
    toInstantExclusive: new Date(
      `${next.year}-${pad2(next.month)}-01T00:00:00.000${SAST_OFFSET}`,
    ).toISOString(),
    label: new Intl.DateTimeFormat("en-ZA", {
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    }).format(new Date(Date.UTC(year, month - 1, 1))),
  };
}

/** The SAST calendar month containing `date`. */
export function sastMonthOf(date: Date = new Date()): SastMonth {
  const parts = new Intl.DateTimeFormat("en-ZA", {
    timeZone: "Africa/Johannesburg",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === type)?.value);
  return { year: get("year"), month: get("month") };
}

export function previousSastMonth({ year, month }: SastMonth): SastMonth {
  return month === 1
    ? { year: year - 1, month: 12 }
    : { year, month: month - 1 };
}

/** The month a billing period bills for. Periods are whole calendar months. */
export function sastMonthFromIso(isoDate: string): SastMonth {
  const [year, month] = isoDate.split("-").map(Number);
  assertMonth(year!, month!);
  return { year: year!, month: month! };
}

/**
 * Sales are only complete once the month has ended in SAST.
 * Billing runs in advance, so the month being *commissioned* is always a
 * closed month; this guard stops a partial figure being billed by mistake.
 */
export function isMonthClosed(
  { year, month }: SastMonth,
  now: Date = new Date(),
): boolean {
  const current = sastMonthOf(now);
  return year * 12 + month < current.year * 12 + current.month;
}
