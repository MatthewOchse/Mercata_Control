import type { DigestCadence, PeriodWindow } from "@/lib/digest/types";

const SAST = "Africa/Johannesburg";

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function sastYmdParts(date: Date = new Date()) {
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

/** Today YYYY-MM-DD in SAST. */
export function digestSastToday(now: Date = new Date()): string {
  const { year, month, day } = sastYmdParts(now);
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

/**
 * ISO weekday in SAST: 1=Mon … 7=Sun.
 */
export function digestSastIsoWeekday(now: Date = new Date()): number {
  const weekday = new Intl.DateTimeFormat("en-ZA", {
    timeZone: SAST,
    weekday: "short",
  }).format(now);
  const map: Record<string, number> = {
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
    Sun: 7,
  };
  return map[weekday] ?? 1;
}

function parseYmd(ymd: string): { y: number; m: number; d: number } {
  const [y, m, d] = ymd.split("-").map(Number);
  return { y, m, d };
}

function ymdFromUtcNoon(y: number, m: number, d: number): string {
  const dt = new Date(Date.UTC(y, m - 1, d));
  return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
}

/** Add calendar days to a YYYY-MM-DD (naive civil arithmetic). */
export function addDaysYmd(ymd: string, delta: number): string {
  const { y, m, d } = parseYmd(ymd);
  return ymdFromUtcNoon(y, m, d + delta);
}

function formatPeriodLabel(from: string, to: string): string {
  const fmt = (ymd: string) => {
    const { y, m, d } = parseYmd(ymd);
    return new Intl.DateTimeFormat("en-ZA", {
      day: "numeric",
      month: "short",
      year: "numeric",
      timeZone: "UTC",
    }).format(new Date(Date.UTC(y, m - 1, d)));
  };
  if (from === to) return fmt(from);
  return `${fmt(from)} – ${fmt(to)}`;
}

export type DigestPeriodPair = {
  period: PeriodWindow;
  previous: PeriodWindow;
};

/**
 * Period covered by a digest sent on `sendDate` (SAST YYYY-MM-DD).
 * Weekly: previous 7 complete days ending yesterday.
 * Daily: yesterday only.
 */
export function periodsForDigest(
  cadence: Exclude<DigestCadence, "off">,
  sendDate: string = digestSastToday(),
): DigestPeriodPair {
  const yesterday = addDaysYmd(sendDate, -1);
  if (cadence === "daily") {
    const prev = addDaysYmd(yesterday, -1);
    return {
      period: {
        from: yesterday,
        to: yesterday,
        label: formatPeriodLabel(yesterday, yesterday),
      },
      previous: {
        from: prev,
        to: prev,
        label: formatPeriodLabel(prev, prev),
      },
    };
  }

  const periodFrom = addDaysYmd(yesterday, -6);
  const prevTo = addDaysYmd(periodFrom, -1);
  const prevFrom = addDaysYmd(prevTo, -6);
  return {
    period: {
      from: periodFrom,
      to: yesterday,
      label: formatPeriodLabel(periodFrom, yesterday),
    },
    previous: {
      from: prevFrom,
      to: prevTo,
      label: formatPeriodLabel(prevFrom, prevTo),
    },
  };
}

/** Whether this tenant should receive a digest on the given SAST calendar day. */
export function shouldSendDigestToday(opts: {
  cadence: DigestCadence;
  digestDay: number;
  now?: Date;
}): boolean {
  if (opts.cadence === "off") return false;
  if (opts.cadence === "daily") return true;
  const day = digestSastIsoWeekday(opts.now);
  return day === opts.digestDay;
}
