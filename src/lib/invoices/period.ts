import { firstDayOfNextMonth } from "@/lib/billing/cycle";

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** Last day of the month containing isoDate (YYYY-MM-DD). */
export function lastDayOfMonthContaining(isoDate: string): string {
  const [y, m] = isoDate.split("-").map(Number);
  const last = new Date(Date.UTC(y!, m!, 0));
  return `${y}-${pad2(m!)}-${pad2(last.getUTCDate())}`;
}

/** Coming billing period: next SAST month (in-advance). */
export function comingBillingPeriod(now = new Date()): {
  periodStart: string;
  periodEnd: string;
} {
  // firstDayOfNextMonth uses SAST "now" via Intl — ignore arg except for tests that mock Date
  void now;
  const periodStart = firstDayOfNextMonth();
  const periodEnd = lastDayOfMonthContaining(periodStart);
  return { periodStart, periodEnd };
}

export function periodLabel(periodStart: string): string {
  const [y, m] = periodStart.split("-").map(Number);
  return new Intl.DateTimeFormat("en-ZA", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(y!, m! - 1, 1)));
}

export function yearFromIso(isoDate: string): number {
  return Number(isoDate.slice(0, 4));
}
