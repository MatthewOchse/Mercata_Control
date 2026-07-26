import type { RowDataPacket } from "mysql2/promise";
import { query } from "@/lib/db/pool";
import { addDaysYmd, digestSastToday } from "@/lib/digest/period";

export type AnalyticsPeriodKey =
  | "1d"
  | "7d"
  | "28d"
  | "30d"
  | "90d"
  | "this_vs_last_month";

export type AnalyticsPeriod = {
  key: AnalyticsPeriodKey;
  from: string;
  to: string;
  prevFrom: string;
  prevTo: string;
  label: string;
};

export function resolveAnalyticsPeriod(
  key: AnalyticsPeriodKey,
  today: string = digestSastToday(),
): AnalyticsPeriod {
  const yesterday = addDaysYmd(today, -1);
  if (key === "1d") {
    const prev = addDaysYmd(yesterday, -1);
    return {
      key,
      from: yesterday,
      to: yesterday,
      prevFrom: prev,
      prevTo: prev,
      label: "Yesterday",
    };
  }
  if (key === "7d") {
    const from = addDaysYmd(yesterday, -6);
    const prevTo = addDaysYmd(from, -1);
    const prevFrom = addDaysYmd(prevTo, -6);
    return {
      key,
      from,
      to: yesterday,
      prevFrom,
      prevTo,
      label: "Last 7 days",
    };
  }
  if (key === "28d") {
    const from = addDaysYmd(yesterday, -27);
    const prevTo = addDaysYmd(from, -1);
    const prevFrom = addDaysYmd(prevTo, -27);
    return {
      key,
      from,
      to: yesterday,
      prevFrom,
      prevTo,
      label: "Last 28 days",
    };
  }
  if (key === "30d") {
    const from = addDaysYmd(yesterday, -29);
    const prevTo = addDaysYmd(from, -1);
    const prevFrom = addDaysYmd(prevTo, -29);
    return {
      key,
      from,
      to: yesterday,
      prevFrom,
      prevTo,
      label: "Last 30 days",
    };
  }
  if (key === "90d") {
    const from = addDaysYmd(yesterday, -89);
    const prevTo = addDaysYmd(from, -1);
    const prevFrom = addDaysYmd(prevTo, -89);
    return {
      key,
      from,
      to: yesterday,
      prevFrom,
      prevTo,
      label: "Last 90 days",
    };
  }

  // this month vs last month (through yesterday for current)
  const [y, m] = today.split("-").map(Number);
  const thisFrom = `${y}-${String(m).padStart(2, "0")}-01`;
  const thisTo = yesterday < thisFrom ? thisFrom : yesterday;
  const lastMonthDate = new Date(Date.UTC(y!, m! - 2, 1));
  const prevFrom = `${lastMonthDate.getUTCFullYear()}-${String(lastMonthDate.getUTCMonth() + 1).padStart(2, "0")}-01`;
  const prevToEnd = new Date(Date.UTC(y!, m! - 1, 0));
  const prevTo = `${prevToEnd.getUTCFullYear()}-${String(prevToEnd.getUTCMonth() + 1).padStart(2, "0")}-${String(prevToEnd.getUTCDate()).padStart(2, "0")}`;
  return {
    key,
    from: thisFrom,
    to: thisTo,
    prevFrom,
    prevTo,
    label: "This month vs last month",
  };
}

function pct(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

export type TenantAnalyticsView = {
  period: AnalyticsPeriod;
  dataAsOf: string | null;
  hasGa4: boolean;
  revenueCents: number;
  revenuePct: number | null;
  orders: number;
  ordersPct: number | null;
  sessions: number | null;
  sessionsPct: number | null;
  conversionRate: number | null;
  conversionPct: number | null;
  series: Array<{
    date: string;
    orders: number;
    sessions: number | null;
    netCents: number;
  }>;
  topProducts: Array<{ description: string; units: number }>;
  topPages: Array<{ path: string; views: number }>;
  topSources: Array<{ source: string; sessions: number }>;
};

async function sumInternal(
  tenantId: number,
  from: string,
  to: string,
): Promise<{ orders: number; netCents: number }> {
  const rows = await query<
    (RowDataPacket & { orders: number; net: number })[]
  >(
    `SELECT COALESCE(SUM(orders), 0) AS orders,
            COALESCE(SUM(net_cents), 0) AS net
     FROM analytics_daily
     WHERE tenant_id = :tid AND source = 'internal'
       AND date BETWEEN :from AND :to`,
    { tid: tenantId, from, to },
  );
  return {
    orders: Number(rows[0]?.orders ?? 0),
    netCents: Number(rows[0]?.net ?? 0),
  };
}

async function sumGa4(
  tenantId: number,
  from: string,
  to: string,
): Promise<{ sessions: number } | null> {
  const rows = await query<(RowDataPacket & { sessions: number; n: number })[]>(
    `SELECT COALESCE(SUM(sessions), 0) AS sessions, COUNT(*) AS n
     FROM analytics_daily
     WHERE tenant_id = :tid AND source = 'ga4'
       AND date BETWEEN :from AND :to`,
    { tid: tenantId, from, to },
  );
  if (Number(rows[0]?.n ?? 0) === 0) return null;
  return { sessions: Number(rows[0]?.sessions ?? 0) };
}

export async function getTenantAnalyticsView(
  tenantId: number,
  periodKey: AnalyticsPeriodKey,
): Promise<TenantAnalyticsView> {
  const period = resolveAnalyticsPeriod(periodKey);
  const [cur, prev, curGa4, prevGa4] = await Promise.all([
    sumInternal(tenantId, period.from, period.to),
    sumInternal(tenantId, period.prevFrom, period.prevTo),
    sumGa4(tenantId, period.from, period.to),
    sumGa4(tenantId, period.prevFrom, period.prevTo),
  ]);

  const hasGa4 = curGa4 !== null;
  const conversionRate =
    hasGa4 && curGa4.sessions > 0
      ? Math.round((cur.orders / curGa4.sessions) * 10000) / 100
      : hasGa4
        ? 0
        : null;
  const prevConv =
    prevGa4 && prevGa4.sessions > 0
      ? (prev.orders / prevGa4.sessions) * 100
      : null;

  const dayRows = await query<
    (RowDataPacket & {
      date: string;
      source: string;
      orders: number | null;
      sessions: number | null;
      net_cents: number | null;
    })[]
  >(
    `SELECT date, source, orders, sessions, net_cents
     FROM analytics_daily
     WHERE tenant_id = :tid AND date BETWEEN :from AND :to
     ORDER BY date ASC`,
    { tid: tenantId, from: period.from, to: period.to },
  );

  const byDate = new Map<
    string,
    { orders: number; sessions: number | null; netCents: number }
  >();
  for (const r of dayRows) {
    const d = String(r.date).slice(0, 10);
    const curDay = byDate.get(d) ?? {
      orders: 0,
      sessions: null as number | null,
      netCents: 0,
    };
    if (r.source === "internal") {
      curDay.orders = Number(r.orders ?? 0);
      curDay.netCents = Number(r.net_cents ?? 0);
    } else {
      curDay.sessions = Number(r.sessions ?? 0);
    }
    byDate.set(d, curDay);
  }

  const series = [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, v]) => ({
      date,
      orders: v.orders,
      sessions: v.sessions,
      netCents: v.netCents,
    }));

  const details = await query<
    (RowDataPacket & { kind: string; payload: unknown })[]
  >(
    `SELECT kind, payload FROM analytics_daily_detail
     WHERE tenant_id = :tid AND date BETWEEN :from AND :to`,
    { tid: tenantId, from: period.from, to: period.to },
  );

  const productMap = new Map<string, number>();
  const pageMap = new Map<string, number>();
  const sourceMap = new Map<string, number>();
  for (const row of details) {
    let payload = row.payload;
    if (typeof payload === "string") {
      try {
        payload = JSON.parse(payload);
      } catch {
        continue;
      }
    }
    if (!Array.isArray(payload)) continue;
    if (row.kind === "top_products") {
      for (const p of payload as Array<{ description?: string; units?: number }>) {
        const name = p.description ?? "Product";
        productMap.set(name, (productMap.get(name) ?? 0) + Number(p.units ?? 0));
      }
    }
    if (row.kind === "top_pages") {
      for (const p of payload as Array<{ path?: string; views?: number }>) {
        const path = p.path ?? "/";
        pageMap.set(path, (pageMap.get(path) ?? 0) + Number(p.views ?? 0));
      }
    }
    if (row.kind === "top_sources") {
      for (const p of payload as Array<{ source?: string; sessions?: number }>) {
        const s = p.source ?? "(unknown)";
        sourceMap.set(s, (sourceMap.get(s) ?? 0) + Number(p.sessions ?? 0));
      }
    }
  }

  const sortTop = <T extends { n: number }>(entries: [string, number][], map: (k: string, n: number) => T) =>
    entries
      .map(([k, n]) => map(k, n))
      .sort((a, b) => b.n - a.n)
      .slice(0, 10);

  const asOf = await query<(RowDataPacket & { ran_at: string })[]>(
    `SELECT ran_at FROM analytics_syncs
     WHERE tenant_id = :tid AND ok = 1
     ORDER BY ran_at DESC LIMIT 1`,
    { tid: tenantId },
  );

  return {
    period,
    dataAsOf: asOf[0]?.ran_at ? String(asOf[0].ran_at) : null,
    hasGa4,
    revenueCents: cur.netCents,
    revenuePct: pct(cur.netCents, prev.netCents),
    orders: cur.orders,
    ordersPct: pct(cur.orders, prev.orders),
    sessions: hasGa4 ? curGa4!.sessions : null,
    sessionsPct:
      hasGa4 && prevGa4 ? pct(curGa4!.sessions, prevGa4.sessions) : null,
    conversionRate,
    conversionPct:
      conversionRate !== null && prevConv !== null
        ? pct(conversionRate, prevConv)
        : null,
    series,
    topProducts: sortTop([...productMap.entries()], (description, units) => ({
      description,
      units,
      n: units,
    })).map(({ description, units }) => ({ description, units })),
    topPages: sortTop([...pageMap.entries()], (path, views) => ({
      path,
      views,
      n: views,
    })).map(({ path, views }) => ({ path, views })),
    topSources: sortTop([...sourceMap.entries()], (source, sessions) => ({
      source,
      sessions,
      n: sessions,
    })).map(({ source, sessions }) => ({ source, sessions })),
  };
}

export type FleetAnalyticsStrip = {
  monthGmvCents: number;
  tenants: Array<{
    tenantId: number;
    slug: string;
    tradingName: string;
    sparkline: number[];
    monthNetCents: number;
  }>;
};

export async function getFleetAnalyticsStrip(): Promise<FleetAnalyticsStrip> {
  const today = digestSastToday();
  const [y, m] = today.split("-").map(Number);
  const monthStart = `${y}-${String(m).padStart(2, "0")}-01`;
  const sparkFrom = addDaysYmd(today, -14);

  const monthRows = await query<
    (RowDataPacket & {
      tenant_id: number;
      slug: string;
      trading_name: string;
      net: number;
    })[]
  >(
    `SELECT t.id AS tenant_id, t.slug, t.trading_name,
            COALESCE(SUM(a.net_cents), 0) AS net
     FROM tenants t
     LEFT JOIN analytics_daily a
       ON a.tenant_id = t.id AND a.source = 'internal'
      AND a.date BETWEEN :from AND :to
     WHERE t.status IN ('active', 'suspended')
     GROUP BY t.id, t.slug, t.trading_name
     ORDER BY net DESC`,
    { from: monthStart, to: today },
  );

  const sparkRows = await query<
    (RowDataPacket & { tenant_id: number; date: string; net_cents: number })[]
  >(
    `SELECT tenant_id, date, COALESCE(net_cents, 0) AS net_cents
     FROM analytics_daily
     WHERE source = 'internal' AND date BETWEEN :from AND :to
     ORDER BY date ASC`,
    { from: sparkFrom, to: today },
  );

  const sparkByTenant = new Map<number, Map<string, number>>();
  for (const r of sparkRows) {
    const tid = Number(r.tenant_id);
    const map = sparkByTenant.get(tid) ?? new Map();
    map.set(String(r.date).slice(0, 10), Number(r.net_cents));
    sparkByTenant.set(tid, map);
  }

  const days: string[] = [];
  for (let d = sparkFrom; d <= today; d = addDaysYmd(d, 1)) days.push(d);

  let monthGmvCents = 0;
  const tenants = monthRows.map((r) => {
    const tid = Number(r.tenant_id);
    const net = Number(r.net);
    monthGmvCents += net;
    const map = sparkByTenant.get(tid) ?? new Map();
    return {
      tenantId: tid,
      slug: r.slug,
      tradingName: r.trading_name,
      monthNetCents: net,
      sparkline: days.map((d) => map.get(d) ?? 0),
    };
  });

  return { monthGmvCents, tenants };
}

/** Aggregate warehouse rows into sales/traffic for digests. */
export async function salesFromWarehouse(
  tenantId: number,
  from: string,
  to: string,
): Promise<{
  ordersCount: number;
  grossSalesCents: number;
  refundsCents: number;
  netSalesCents: number;
  topProducts: Array<{ description: string; units: number }>;
} | null> {
  const rows = await query<
    (RowDataPacket & {
      orders: number;
      gross: number;
      refunds: number;
      net: number;
      n: number;
    })[]
  >(
    `SELECT COALESCE(SUM(orders),0) AS orders,
            COALESCE(SUM(gross_cents),0) AS gross,
            COALESCE(SUM(refunds_cents),0) AS refunds,
            COALESCE(SUM(net_cents),0) AS net,
            COUNT(*) AS n
     FROM analytics_daily
     WHERE tenant_id = :tid AND source = 'internal'
       AND date BETWEEN :from AND :to`,
    { tid: tenantId, from, to },
  );
  if (Number(rows[0]?.n ?? 0) === 0) return null;

  const details = await query<(RowDataPacket & { payload: unknown })[]>(
    `SELECT payload FROM analytics_daily_detail
     WHERE tenant_id = :tid AND kind = 'top_products'
       AND date BETWEEN :from AND :to`,
    { tid: tenantId, from, to },
  );
  const map = new Map<string, number>();
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
    for (const p of payload as Array<{ description?: string; units?: number }>) {
      const name = p.description ?? "Product";
      map.set(name, (map.get(name) ?? 0) + Number(p.units ?? 0));
    }
  }

  return {
    ordersCount: Number(rows[0]!.orders),
    grossSalesCents: Number(rows[0]!.gross),
    refundsCents: Number(rows[0]!.refunds),
    netSalesCents: Number(rows[0]!.net),
    topProducts: [...map.entries()]
      .map(([description, units]) => ({ description, units }))
      .sort((a, b) => b.units - a.units)
      .slice(0, 5),
  };
}

export async function trafficFromWarehouse(
  tenantId: number,
  from: string,
  to: string,
): Promise<{
  sessions: number;
  users: number;
  topPages: Array<{ path: string; views: number }>;
  topSources: Array<{ source: string; sessions: number }>;
} | null> {
  const rows = await query<
    (RowDataPacket & { sessions: number; users: number; n: number })[]
  >(
    `SELECT COALESCE(SUM(sessions),0) AS sessions,
            COALESCE(SUM(users),0) AS users,
            COUNT(*) AS n
     FROM analytics_daily
     WHERE tenant_id = :tid AND source = 'ga4'
       AND date BETWEEN :from AND :to`,
    { tid: tenantId, from, to },
  );
  if (Number(rows[0]?.n ?? 0) === 0) return null;

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

  return {
    sessions: Number(rows[0]!.sessions),
    users: Number(rows[0]!.users),
    topPages: [...pageMap.entries()]
      .map(([path, views]) => ({ path, views }))
      .sort((a, b) => b.views - a.views)
      .slice(0, 10),
    topSources: [...sourceMap.entries()]
      .map(([source, sessions]) => ({ source, sessions }))
      .sort((a, b) => b.sessions - a.sessions)
      .slice(0, 10),
  };
}

export async function busiestSalesDay(
  tenantId: number,
  from: string,
  to: string,
): Promise<string | null> {
  const rows = await query<(RowDataPacket & { date: string; net: number })[]>(
    `SELECT date, COALESCE(net_cents, 0) AS net
     FROM analytics_daily
     WHERE tenant_id = :tid AND source = 'internal'
       AND date BETWEEN :from AND :to
     ORDER BY net DESC, date ASC LIMIT 1`,
    { tid: tenantId, from, to },
  );
  if (!rows[0] || Number(rows[0].net) <= 0) return null;
  const d = String(rows[0].date).slice(0, 10);
  const [y, m, day] = d.split("-").map(Number);
  return new Intl.DateTimeFormat("en-ZA", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(y!, m! - 1, day)));
}
