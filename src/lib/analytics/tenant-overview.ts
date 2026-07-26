import type { RowDataPacket } from "mysql2/promise";
import {
  fetchGa4Overview,
  Ga4PermissionError,
  ga4ViewerGrantMessage,
  type Ga4OverviewLive,
} from "@/lib/analytics/ga4";
import {
  resolveDetailRange,
  type DetailRange,
} from "@/lib/analytics/detail-range";
import { execute, query } from "@/lib/db/pool";

export type { DetailRange } from "@/lib/analytics/detail-range";
export {
  DEFAULT_DETAIL_RANGE,
  DETAIL_RANGES,
  isDetailRange,
  resolveDetailRange,
} from "@/lib/analytics/detail-range";

export type TenantTrafficOverview = Ga4OverviewLive & {
  source: "warehouse" | "live";
};

export class TenantTrafficError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "TenantTrafficError";
    this.code = code;
  }
}

const TTL_MS = 15 * 60 * 1000;

async function readGa4Cache(
  key: string,
): Promise<Ga4OverviewLive | null> {
  const rows = await query<
    (RowDataPacket & { payload: unknown; fetched_at: string | Date })[]
  >(
    `SELECT payload, fetched_at FROM ga4_cache WHERE cache_key = :key LIMIT 1`,
    { key },
  );
  const row = rows[0];
  if (!row) return null;
  const fetchedAt = new Date(row.fetched_at).getTime();
  if (Number.isNaN(fetchedAt) || Date.now() - fetchedAt >= TTL_MS) {
    return null;
  }
  let payload = row.payload;
  if (typeof payload === "string") {
    try {
      payload = JSON.parse(payload);
    } catch {
      return null;
    }
  }
  return payload as Ga4OverviewLive;
}

async function writeGa4Cache(key: string, payload: Ga4OverviewLive): Promise<void> {
  await execute(
    `INSERT INTO ga4_cache (cache_key, payload, fetched_at)
     VALUES (:key, CAST(:payload AS JSON), NOW())
     ON DUPLICATE KEY UPDATE
       payload = VALUES(payload),
       fetched_at = NOW()`,
    { key, payload: JSON.stringify(payload) },
  );
}

async function warehouseOverview(
  tenantId: number,
  from: string,
  to: string,
): Promise<TenantTrafficOverview | null> {
  const rows = await query<
    (RowDataPacket & {
      date: string;
      sessions: number;
      users: number;
      pageviews: number;
    })[]
  >(
    `SELECT date,
            COALESCE(sessions, 0) AS sessions,
            COALESCE(users, 0) AS users,
            COALESCE(pageviews, 0) AS pageviews
     FROM analytics_daily
     WHERE tenant_id = :tid AND source = 'ga4'
       AND date BETWEEN :from AND :to
     ORDER BY date ASC`,
    { tid: tenantId, from, to },
  );
  if (rows.length === 0) return null;

  const details = await query<
    (RowDataPacket & { kind: string; payload: unknown })[]
  >(
    `SELECT kind, payload FROM analytics_daily_detail
     WHERE tenant_id = :tid AND kind IN ('top_pages','top_sources')
       AND date BETWEEN :from AND :to`,
    { tid: tenantId, from, to },
  );

  const pageMap = new Map<string, number>();
  const sourceMap = new Map<string, number>();
  for (const d of details) {
    let payload = d.payload;
    if (typeof payload === "string") {
      try {
        payload = JSON.parse(payload);
      } catch {
        continue;
      }
    }
    if (!Array.isArray(payload)) continue;
    if (d.kind === "top_pages") {
      for (const p of payload as Array<{ path?: string; views?: number }>) {
        const path = p.path ?? "/";
        pageMap.set(path, (pageMap.get(path) ?? 0) + Number(p.views ?? 0));
      }
    } else {
      for (const p of payload as Array<{ source?: string; sessions?: number }>) {
        const s = p.source ?? "(unknown)";
        sourceMap.set(s, (sourceMap.get(s) ?? 0) + Number(p.sessions ?? 0));
      }
    }
  }

  const series = rows.map((r) => ({
    date: String(r.date).slice(0, 10),
    users: Number(r.users),
    sessions: Number(r.sessions),
  }));

  return {
    activeUsers: series.reduce((a, r) => a + r.users, 0),
    sessions: series.reduce((a, r) => a + r.sessions, 0),
    screenPageViews: rows.reduce((a, r) => a + Number(r.pageviews), 0),
    avgSessionDuration: 0,
    series,
    topPages: [...pageMap.entries()]
      .map(([path, views]) => ({ path, views }))
      .sort((a, b) => b.views - a.views)
      .slice(0, 8),
    topSources: [...sourceMap.entries()]
      .map(([source, sessions]) => ({ source, sessions }))
      .sort((a, b) => b.sessions - a.sessions)
      .slice(0, 6),
    source: "warehouse",
  };
}

/**
 * Traffic column for the dashboard tenant detail panel.
 * Warehouse first; live GA4 (+ 15m ga4_cache) only when warehouse empty.
 */
export async function getTenantTraffic(
  opts: {
    tenantId: number;
    propertyId: string | null;
    range: DetailRange;
  },
): Promise<TenantTrafficOverview | null> {
  if (!opts.propertyId?.trim()) {
    throw new TenantTrafficError(
      "ga4_not_configured",
      "Add the property ID in tenant settings",
    );
  }

  const { from, to } = resolveDetailRange(opts.range);
  const fromWh = await warehouseOverview(opts.tenantId, from, to);
  if (fromWh) return fromWh;

  const cacheKey = `${opts.propertyId.trim()}:${opts.range}:overview`;
  const cached = await readGa4Cache(cacheKey);
  if (cached) {
    return { ...cached, source: "live" };
  }

  try {
    const live = await fetchGa4Overview(opts.propertyId, opts.range);
    await writeGa4Cache(cacheKey, live);
    return { ...live, source: "live" };
  } catch (err) {
    if (err instanceof Ga4PermissionError) {
      throw new TenantTrafficError("PERMISSION_DENIED", err.message);
    }
    const msg = err instanceof Error ? err.message : "GA4 request failed";
    if (/PERMISSION_DENIED|403/i.test(msg)) {
      throw new TenantTrafficError(
        "PERMISSION_DENIED",
        ga4ViewerGrantMessage(),
      );
    }
    throw new TenantTrafficError("ga4_error", msg);
  }
}
