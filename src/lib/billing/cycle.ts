/** Billing cycle dates in Africa/Johannesburg calendar days (DATE columns). */

const SAST = "Africa/Johannesburg";

function sastParts(date: Date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-ZA", {
    timeZone: SAST,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === type)?.value);
  return { year: get("year"), month: get("month"), day: get("day") };
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** Today as YYYY-MM-DD in SAST. */
export function sastToday(): string {
  const { year, month, day } = sastParts();
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

/** First calendar day of the current SAST month (YYYY-MM-DD). */
export function firstDayOfThisMonth(): string {
  const { year, month } = sastParts();
  return `${year}-${pad2(month)}-01`;
}

/** Last calendar day of the current SAST month (YYYY-MM-DD). */
export function lastDayOfThisMonth(): string {
  const { year, month } = sastParts();
  // Day 0 of next month = last day of this month (UTC noon avoids DST edge cases).
  const last = new Date(Date.UTC(year, month, 0));
  return `${year}-${pad2(month)}-${pad2(last.getUTCDate())}`;
}

/** First calendar day of next SAST month (YYYY-MM-DD). */
export function firstDayOfNextMonth(): string {
  const { year, month } = sastParts();
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear = month === 12 ? year + 1 : year;
  return `${nextYear}-${pad2(nextMonth)}-01`;
}

/**
 * Due date from a billing day-of-month (1–28).
 * Uses the invoice period's month; if that day is already before issueDate,
 * rolls forward to the next month.
 */
export function dueDateForBillingDay(
  issueDate: string,
  periodStart: string,
  billingDay: number,
): string {
  const day = Math.min(28, Math.max(1, Math.trunc(billingDay)));
  const [iy, im] = issueDate.slice(0, 10).split("-").map(Number);
  const [py, pm] = periodStart.slice(0, 10).split("-").map(Number);
  if (!iy || !im || !py || !pm) {
    throw new Error(`Invalid dates for dueDateForBillingDay`);
  }

  function clampDay(year: number, month: number, d: number): string {
    const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
    return `${year}-${pad2(month)}-${pad2(Math.min(d, last))}`;
  }

  let due = clampDay(py, pm, day);
  if (due < issueDate.slice(0, 10)) {
    const nextMonth = pm === 12 ? 1 : pm + 1;
    const nextYear = pm === 12 ? py + 1 : py;
    due = clampDay(nextYear, nextMonth, day);
  }
  // Still before issue (edge): use issue month's next occurrence from issue date
  if (due < issueDate.slice(0, 10)) {
    const nextMonth = im === 12 ? 1 : im + 1;
    const nextYear = im === 12 ? iy + 1 : iy;
    due = clampDay(nextYear, nextMonth, day);
  }
  return due;
}

export function formatIsoDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = String(iso).slice(0, 10);
  const [y, m, day] = d.split("-").map(Number);
  if (!y || !m || !day) return d;
  return new Intl.DateTimeFormat("en-ZA", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(y, m - 1, day)));
}
