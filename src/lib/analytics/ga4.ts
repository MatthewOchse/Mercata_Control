import { google } from "googleapis";

export type Ga4Credentials = object;

export function loadGa4ServiceAccount(): Ga4Credentials | null {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim();
  if (!raw) return null;
  try {
    return JSON.parse(raw) as object;
  } catch {
    return null;
  }
}

export function normalisePropertyId(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  return trimmed.startsWith("properties/")
    ? trimmed
    : `properties/${trimmed}`;
}

export function numericPropertyId(raw: string): string {
  return normalisePropertyId(raw).replace(/^properties\//, "");
}

async function analyticsAdminClient() {
  const credentials = loadGa4ServiceAccount();
  if (!credentials) {
    throw new Error(
      "GOOGLE_SERVICE_ACCOUNT_JSON is not configured on this server",
    );
  }
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/analytics.readonly"],
  });
  return {
    auth,
    admin: google.analyticsadmin({ version: "v1beta", auth }),
    data: google.analyticsdata({ version: "v1beta", auth }),
  };
}

export type Ga4VerifyResult = {
  propertyId: string;
  displayName: string;
};

/** Round-trip: Admin API properties.get → display name. */
export async function verifyGa4Property(
  propertyIdRaw: string,
): Promise<Ga4VerifyResult> {
  const property = normalisePropertyId(propertyIdRaw);
  if (!property) throw new Error("GA4 property ID is required");

  const { admin } = await analyticsAdminClient();
  const res = await admin.properties.get({ name: property });
  const displayName =
    res.data.displayName?.trim() ||
    res.data.name?.replace(/^properties\//, "") ||
    property;
  return {
    propertyId: numericPropertyId(propertyIdRaw),
    displayName,
  };
}

export type Ga4DailyRow = {
  date: string; // YYYY-MM-DD
  sessions: number;
  users: number;
  newUsers: number;
  pageviews: number;
  engagedSessions: number;
};

export type Ga4DayDetail = {
  date: string;
  topPages: Array<{ path: string; views: number }>;
  topSources: Array<{ source: string; sessions: number }>;
};

function ga4DateToIso(yyyymmdd: string): string {
  const m = yyyymmdd.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (!m) return yyyymmdd;
  return `${m[1]}-${m[2]}-${m[3]}`;
}

/** Fetch daily traffic metrics for a date range (inclusive). */
export async function fetchGa4DailyMetrics(opts: {
  propertyId: string;
  from: string;
  to: string;
}): Promise<{ days: Ga4DailyRow[]; details: Ga4DayDetail[] }> {
  const { data } = await analyticsAdminClient();
  const property = normalisePropertyId(opts.propertyId);

  const [summary, pages, sources] = await Promise.all([
    data.properties.runReport({
      property,
      requestBody: {
        dateRanges: [{ startDate: opts.from, endDate: opts.to }],
        dimensions: [{ name: "date" }],
        metrics: [
          { name: "sessions" },
          { name: "totalUsers" },
          { name: "newUsers" },
          { name: "screenPageViews" },
          { name: "engagedSessions" },
        ],
        orderBys: [{ dimension: { dimensionName: "date" } }],
      },
    }),
    data.properties.runReport({
      property,
      requestBody: {
        dateRanges: [{ startDate: opts.from, endDate: opts.to }],
        dimensions: [{ name: "date" }, { name: "pagePath" }],
        metrics: [{ name: "screenPageViews" }],
        orderBys: [
          { dimension: { dimensionName: "date" } },
          { metric: { metricName: "screenPageViews" }, desc: true },
        ],
        limit: "200",
      },
    }),
    data.properties.runReport({
      property,
      requestBody: {
        dateRanges: [{ startDate: opts.from, endDate: opts.to }],
        dimensions: [
          { name: "date" },
          { name: "sessionDefaultChannelGroup" },
        ],
        metrics: [{ name: "sessions" }],
        orderBys: [
          { dimension: { dimensionName: "date" } },
          { metric: { metricName: "sessions" }, desc: true },
        ],
        limit: "200",
      },
    }),
  ]);

  const days: Ga4DailyRow[] = (summary.data.rows ?? []).map((row) => {
    const date = ga4DateToIso(row.dimensionValues?.[0]?.value ?? "");
    const m = row.metricValues ?? [];
    return {
      date,
      sessions: Number(m[0]?.value ?? 0),
      users: Number(m[1]?.value ?? 0),
      newUsers: Number(m[2]?.value ?? 0),
      pageviews: Number(m[3]?.value ?? 0),
      engagedSessions: Number(m[4]?.value ?? 0),
    };
  });

  const pagesByDate = new Map<string, Array<{ path: string; views: number }>>();
  for (const row of pages.data.rows ?? []) {
    const date = ga4DateToIso(row.dimensionValues?.[0]?.value ?? "");
    const path = row.dimensionValues?.[1]?.value ?? "/";
    const views = Number(row.metricValues?.[0]?.value ?? 0);
    const list = pagesByDate.get(date) ?? [];
    if (list.length < 10) list.push({ path, views });
    pagesByDate.set(date, list);
  }

  const sourcesByDate = new Map<
    string,
    Array<{ source: string; sessions: number }>
  >();
  for (const row of sources.data.rows ?? []) {
    const date = ga4DateToIso(row.dimensionValues?.[0]?.value ?? "");
    const source = row.dimensionValues?.[1]?.value ?? "(unknown)";
    const sessions = Number(row.metricValues?.[0]?.value ?? 0);
    const list = sourcesByDate.get(date) ?? [];
    if (list.length < 10) list.push({ source, sessions });
    sourcesByDate.set(date, list);
  }

  const detailDates = new Set([
    ...pagesByDate.keys(),
    ...sourcesByDate.keys(),
    ...days.map((d) => d.date),
  ]);
  const details: Ga4DayDetail[] = [...detailDates].map((date) => ({
    date,
    topPages: pagesByDate.get(date) ?? [],
    topSources: sourcesByDate.get(date) ?? [],
  }));

  return { days, details };
}

export type Ga4OverviewLive = {
  activeUsers: number;
  sessions: number;
  screenPageViews: number;
  avgSessionDuration: number;
  series: { date: string; users: number; sessions: number }[];
  topPages: { path: string; views: number }[];
  topSources: { source: string; sessions: number }[];
};

export class Ga4PermissionError extends Error {
  readonly code = "PERMISSION_DENIED" as const;
  constructor(message: string) {
    super(message);
    this.name = "Ga4PermissionError";
  }
}

function isGa4PermissionDenied(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  const code =
    err && typeof err === "object" && "code" in err
      ? String((err as { code?: unknown }).code)
      : "";
  return (
    code === "403" ||
    /PERMISSION_DENIED|403|permission.?denied/i.test(msg)
  );
}

export function ga4ViewerGrantMessage(): string {
  const creds = loadGa4ServiceAccount() as { client_email?: string } | null;
  const email =
    creds?.client_email?.trim() ||
    "mercata-analytics@mercata-analytics.iam.gserviceaccount.com";
  return `Analytics not connected — add ${email} as Viewer on this property`;
}

/** Interactive overview (1d / 7d / 28d / 90d) for the dashboard tenant panel. */
export async function fetchGa4Overview(
  propertyId: string,
  range: "1d" | "7d" | "28d" | "90d",
): Promise<Ga4OverviewLive> {
  const startDate =
    range === "1d"
      ? "yesterday"
      : ({ "7d": "7daysAgo", "28d": "28daysAgo", "90d": "90daysAgo" } as const)[
          range
        ];
  const endDate = range === "1d" ? "yesterday" : "today";
  try {
    const { data } = await analyticsAdminClient();
    const property = normalisePropertyId(propertyId);
    const dateRanges = [{ startDate, endDate }];

    const [byDate, byPage, bySource] = await Promise.all([
      data.properties.runReport({
        property,
        requestBody: {
          dateRanges,
          dimensions: [{ name: "date" }],
          metrics: [
            { name: "activeUsers" },
            { name: "sessions" },
            { name: "screenPageViews" },
            { name: "averageSessionDuration" },
          ],
          orderBys: [{ dimension: { dimensionName: "date" } }],
        },
      }),
      data.properties.runReport({
        property,
        requestBody: {
          dateRanges,
          dimensions: [{ name: "pagePath" }],
          metrics: [{ name: "screenPageViews" }],
          orderBys: [
            { metric: { metricName: "screenPageViews" }, desc: true },
          ],
          limit: "8",
        },
      }),
      data.properties.runReport({
        property,
        requestBody: {
          dateRanges,
          dimensions: [{ name: "sessionSource" }],
          metrics: [{ name: "sessions" }],
          orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
          limit: "6",
        },
      }),
    ]);

    const rows = byDate.data.rows ?? [];
    const num = (
      r: (typeof rows)[number],
      i: number,
    ): number => Number(r.metricValues?.[i]?.value ?? 0);

    return {
      activeUsers: rows.reduce((a, r) => a + num(r, 0), 0),
      sessions: rows.reduce((a, r) => a + num(r, 1), 0),
      screenPageViews: rows.reduce((a, r) => a + num(r, 2), 0),
      avgSessionDuration: rows.length
        ? rows.reduce((a, r) => a + num(r, 3), 0) / rows.length
        : 0,
      series: rows.map((r) => ({
        date: ga4DateToIso(r.dimensionValues?.[0]?.value ?? ""),
        users: num(r, 0),
        sessions: num(r, 1),
      })),
      topPages: (byPage.data.rows ?? []).map((r) => ({
        path: r.dimensionValues?.[0]?.value ?? "/",
        views: Number(r.metricValues?.[0]?.value ?? 0),
      })),
      topSources: (bySource.data.rows ?? []).map((r) => ({
        source: r.dimensionValues?.[0]?.value || "(direct)",
        sessions: Number(r.metricValues?.[0]?.value ?? 0),
      })),
    };
  } catch (err) {
    if (isGa4PermissionDenied(err)) {
      throw new Ga4PermissionError(ga4ViewerGrantMessage());
    }
    throw err;
  }
}

/** Period aggregate for digests / live fallback (sum + top lists). */
export async function fetchGa4PeriodTraffic(opts: {
  propertyId: string;
  from: string;
  to: string;
}): Promise<{
  sessions: number;
  users: number;
  topPages: Array<{ path: string; views: number }>;
  topSources: Array<{ source: string; sessions: number }>;
} | null> {
  try {
    const { data } = await analyticsAdminClient();
    const property = normalisePropertyId(opts.propertyId);
    const [summary, pages, sources] = await Promise.all([
      data.properties.runReport({
        property,
        requestBody: {
          dateRanges: [{ startDate: opts.from, endDate: opts.to }],
          metrics: [{ name: "sessions" }, { name: "totalUsers" }],
        },
      }),
      data.properties.runReport({
        property,
        requestBody: {
          dateRanges: [{ startDate: opts.from, endDate: opts.to }],
          dimensions: [{ name: "pagePath" }],
          metrics: [{ name: "screenPageViews" }],
          orderBys: [
            { metric: { metricName: "screenPageViews" }, desc: true },
          ],
          limit: "10",
        },
      }),
      data.properties.runReport({
        property,
        requestBody: {
          dateRanges: [{ startDate: opts.from, endDate: opts.to }],
          dimensions: [{ name: "sessionDefaultChannelGroup" }],
          metrics: [{ name: "sessions" }],
          orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
          limit: "10",
        },
      }),
    ]);
    const summaryRow = summary.data.rows?.[0]?.metricValues;
    return {
      sessions: Number(summaryRow?.[0]?.value ?? 0),
      users: Number(summaryRow?.[1]?.value ?? 0),
      topPages: (pages.data.rows ?? []).map((row) => ({
        path: row.dimensionValues?.[0]?.value ?? "/",
        views: Number(row.metricValues?.[0]?.value ?? 0),
      })),
      topSources: (sources.data.rows ?? []).map((row) => ({
        source: row.dimensionValues?.[0]?.value ?? "(unknown)",
        sessions: Number(row.metricValues?.[0]?.value ?? 0),
      })),
    };
  } catch (err) {
    console.error(
      `[ga4] period traffic failed property=${opts.propertyId}:`,
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}
