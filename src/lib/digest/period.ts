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
  return { y: y!, m: m!, d: d! };
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
 * daily → yesterday
 * weekly → previous Mon–Sun (calendar week before the send week's Monday)
 * monthly → previous calendar month
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

  if (cadence === "monthly") {
    const { y, m } = parseYmd(sendDate);
    // Previous month: day 0 of current month
    const prevMonthLast = new Date(Date.UTC(y, m - 1, 0));
    const prevTo = `${prevMonthLast.getUTCFullYear()}-${pad2(prevMonthLast.getUTCMonth() + 1)}-${pad2(prevMonthLast.getUTCDate())}`;
    const prevFrom = `${prevMonthLast.getUTCFullYear()}-${pad2(prevMonthLast.getUTCMonth() + 1)}-01`;
    // Month before that
    const beforeLast = new Date(Date.UTC(y, m - 2, 0));
    const beforeTo = `${beforeLast.getUTCFullYear()}-${pad2(beforeLast.getUTCMonth() + 1)}-${pad2(beforeLast.getUTCDate())}`;
    const beforeFrom = `${beforeLast.getUTCFullYear()}-${pad2(beforeLast.getUTCMonth() + 1)}-01`;
    return {
      period: {
        from: prevFrom,
        to: prevTo,
        label: formatPeriodLabel(prevFrom, prevTo),
      },
      previous: {
        from: beforeFrom,
        to: beforeTo,
        label: formatPeriodLabel(beforeFrom, beforeTo),
      },
    };
  }

  // Weekly: previous complete Mon–Sun relative to send date
  // Find Monday of the week containing sendDate, then previous Mon–Sun
  const wd = (() => {
    // Use ISO weekday of sendDate in civil terms via UTC noon trick + SAST weekday table
    const { y, m, d } = parseYmd(sendDate);
    const utc = new Date(Date.UTC(y, m - 1, d, 12));
    // getUTCDay: 0=Sun..6=Sat → ISO 1=Mon..7=Sun
    const sun0 = utc.getUTCDay();
    return sun0 === 0 ? 7 : sun0;
  })();
  const thisMonday = addDaysYmd(sendDate, -(wd - 1));
  const periodTo = addDaysYmd(thisMonday, -1); // Sunday before this Monday
  const periodFrom = addDaysYmd(periodTo, -6); // Monday of that week
  const prevTo = addDaysYmd(periodFrom, -1);
  const prevFrom = addDaysYmd(prevTo, -6);
  return {
    period: {
      from: periodFrom,
      to: periodTo,
      label: formatPeriodLabel(periodFrom, periodTo),
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
  if (opts.cadence === "monthly") {
    const { day } = sastYmdParts(opts.now ?? new Date());
    return day === 1;
  }
  const day = digestSastIsoWeekday(opts.now);
  return day === opts.digestDay;
}
