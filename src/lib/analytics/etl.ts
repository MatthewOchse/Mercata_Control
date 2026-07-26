import type { RowDataPacket } from "mysql2/promise";
import { writeAuditLog } from "@/lib/db/audit";
import { query, withTransaction, execute } from "@/lib/db/pool";
import {
  fetchGa4DailyMetrics,
  verifyGa4Property,
} from "@/lib/analytics/ga4";
import { addDaysYmd, digestSastToday } from "@/lib/digest/period";
import { fleetAnalyticsSource } from "@/lib/digest/sources/fleet";

export async function testAndStoreGa4Connection(opts: {
  tenantId: number;
  slug: string;
  propertyId: string;
  actor: string;
}): Promise<{ displayName: string }> {
  const result = await verifyGa4Property(opts.propertyId);
  await withTransaction(async (conn) => {
    await conn.execute(
      `UPDATE tenants
       SET ga4_property_id = ?,
           ga4_display_name = ?,
           ga4_verified_at = UTC_TIMESTAMP(3),
           ga4_consecutive_failures = 0
       WHERE id = ?`,
      [result.propertyId, result.displayName, opts.tenantId],
    );
    await writeAuditLog(conn, {
      actor: opts.actor,
      action: "ga4.verify",
      entityType: "tenant",
      entityId: opts.tenantId,
      after: {
        slug: opts.slug,
        property_id: result.propertyId,
        display_name: result.displayName,
      },
    });
  });
  return { displayName: result.displayName };
}

async function logSync(opts: {
  tenantId: number;
  source: "internal" | "ga4";
  periodStart: string;
  periodEnd: string;
  ok: boolean;
  error: string | null;
  rowsWritten: number;
}): Promise<void> {
  await query(
    `INSERT INTO analytics_syncs
       (tenant_id, source, period_start, period_end, ok, error, rows_written)
     VALUES (:tenantId, :source, :periodStart, :periodEnd, :ok, :error, :rows)`,
    {
      tenantId: opts.tenantId,
      source: opts.source,
      periodStart: opts.periodStart,
      periodEnd: opts.periodEnd,
      ok: opts.ok ? 1 : 0,
      error: opts.error,
      rows: opts.rowsWritten,
    },
  );
}

async function upsertInternalDay(opts: {
  tenantId: number;
  date: string;
  orders: number;
  grossCents: number;
  refundsCents: number;
  netCents: number;
  topProducts: unknown;
}): Promise<void> {
  await query(
    `INSERT INTO analytics_daily
       (tenant_id, date, source, orders, gross_cents, refunds_cents, net_cents)
     VALUES (:tenantId, :date, 'internal', :orders, :gross, :refunds, :net)
     ON DUPLICATE KEY UPDATE
       orders = VALUES(orders),
       gross_cents = VALUES(gross_cents),
       refunds_cents = VALUES(refunds_cents),
       net_cents = VALUES(net_cents)`,
    {
      tenantId: opts.tenantId,
      date: opts.date,
      orders: opts.orders,
      gross: opts.grossCents,
      refunds: opts.refundsCents,
      net: opts.netCents,
    },
  );
  await query(
    `INSERT INTO analytics_daily_detail (tenant_id, date, kind, payload)
     VALUES (:tenantId, :date, 'top_products', CAST(:payload AS JSON))
     ON DUPLICATE KEY UPDATE payload = VALUES(payload)`,
    {
      tenantId: opts.tenantId,
      date: opts.date,
      payload: JSON.stringify(opts.topProducts),
    },
  );
}

async function upsertGa4Day(opts: {
  tenantId: number;
  date: string;
  sessions: number;
  users: number;
  newUsers: number;
  pageviews: number;
  engagedSessions: number;
}): Promise<void> {
  await query(
    `INSERT INTO analytics_daily
       (tenant_id, date, source, sessions, users, new_users, pageviews, engaged_sessions)
     VALUES (:tenantId, :date, 'ga4', :sessions, :users, :newUsers, :pageviews, :engaged)
     ON DUPLICATE KEY UPDATE
       sessions = VALUES(sessions),
       users = VALUES(users),
       new_users = VALUES(new_users),
       pageviews = VALUES(pageviews),
       engaged_sessions = VALUES(engaged_sessions)`,
    {
      tenantId: opts.tenantId,
      date: opts.date,
      sessions: opts.sessions,
      users: opts.users,
      newUsers: opts.newUsers,
      pageviews: opts.pageviews,
      engaged: opts.engagedSessions,
    },
  );
}

async function upsertGa4Detail(opts: {
  tenantId: number;
  date: string;
  topPages: unknown;
  topSources: unknown;
}): Promise<void> {
  await query(
    `INSERT INTO analytics_daily_detail (tenant_id, date, kind, payload)
     VALUES (:tenantId, :date, 'top_pages', CAST(:pages AS JSON))
     ON DUPLICATE KEY UPDATE payload = VALUES(payload)`,
    {
      tenantId: opts.tenantId,
      date: opts.date,
      pages: JSON.stringify(opts.topPages),
    },
  );
  await query(
    `INSERT INTO analytics_daily_detail (tenant_id, date, kind, payload)
     VALUES (:tenantId, :date, 'top_sources', CAST(:sources AS JSON))
     ON DUPLICATE KEY UPDATE payload = VALUES(payload)`,
    {
      tenantId: opts.tenantId,
      date: opts.date,
      sources: JSON.stringify(opts.topSources),
    },
  );
}

async function recordGa4Failure(tenantId: number, slug: string): Promise<void> {
  await withTransaction(async (conn) => {
    await conn.execute(
      `UPDATE tenants
       SET ga4_consecutive_failures = ga4_consecutive_failures + 1
       WHERE id = ?`,
      [tenantId],
    );
    const [rows] = await conn.execute<
      (RowDataPacket & { ga4_consecutive_failures: number })[]
    >(
      `SELECT ga4_consecutive_failures FROM tenants WHERE id = ? LIMIT 1`,
      [tenantId],
    );
    const n = Number(rows[0]?.ga4_consecutive_failures ?? 0);
    if (n === 3) {
      await conn.execute(
        `INSERT INTO operator_tasks (kind, tenant_id, title, body, status)
         VALUES ('ga4_failure', ?, ?, ?, 'open')`,
        [
          tenantId,
          `GA4 failing for ${slug}`,
          `3 consecutive GA4 sync/API failures for tenant ${slug}. Check property access for the Mercata analytics service account.`,
        ],
      );
    }
  });
}

async function clearGa4Failures(tenantId: number): Promise<void> {
  await query(
    `UPDATE tenants SET ga4_consecutive_failures = 0 WHERE id = :id`,
    { id: tenantId },
  );
}

type EtlTenant = {
  id: number;
  slug: string;
  primary_domain: string;
  fleet_secret: string;
  ga4_property_id: string | null;
  ga4_verified_at: string | null;
};

export type AnalyticsEtlSummary = {
  tenants: number;
  internalOk: number;
  ga4Ok: number;
  errors: string[];
  prunedDetailRows: number;
};

/** Nightly ETL — last complete SAST day for internal; trailing 3 days for GA4. */
export async function runAnalyticsEtl(
  now: Date = new Date(),
): Promise<AnalyticsEtlSummary> {
  const today = digestSastToday(now);
  const yesterday = addDaysYmd(today, -1);
  const ga4From = addDaysYmd(yesterday, -2);

  const tenants = await query<(EtlTenant & RowDataPacket)[]>(
    `SELECT t.id, t.slug, i.primary_domain, i.fleet_secret,
            t.ga4_property_id, t.ga4_verified_at
     FROM tenants t
     INNER JOIN tenant_infra i ON i.tenant_id = t.id
     WHERE t.status IN ('active', 'suspended')`,
  );

  const summary: AnalyticsEtlSummary = {
    tenants: tenants.length,
    internalOk: 0,
    ga4Ok: 0,
    errors: [],
    prunedDetailRows: 0,
  };

  for (const t of tenants) {
    // Internal — only yesterday, never re-fetched for older days
    const existingInternal = await query<(RowDataPacket & { n: number })[]>(
      `SELECT COUNT(*) AS n FROM analytics_daily
       WHERE tenant_id = :tid AND date = :d AND source = 'internal'`,
      { tid: t.id, d: yesterday },
    );
    if (Number(existingInternal[0]?.n ?? 0) === 0) {
      try {
        const sales = await fleetAnalyticsSource.fetchSales({
          tenantId: Number(t.id),
          slug: t.slug,
          primaryDomain: t.primary_domain,
          fleetSecretCipher: t.fleet_secret,
          from: yesterday,
          to: yesterday,
        });
        await upsertInternalDay({
          tenantId: Number(t.id),
          date: yesterday,
          orders: sales.ordersCount,
          grossCents: sales.grossSalesCents,
          refundsCents: sales.refundsCents,
          netCents: sales.netSalesCents,
          topProducts: sales.topProducts,
        });
        await logSync({
          tenantId: Number(t.id),
          source: "internal",
          periodStart: yesterday,
          periodEnd: yesterday,
          ok: true,
          error: null,
          rowsWritten: 1,
        });
        summary.internalOk++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        summary.errors.push(`${t.slug} internal: ${msg}`);
        await logSync({
          tenantId: Number(t.id),
          source: "internal",
          periodStart: yesterday,
          periodEnd: yesterday,
          ok: false,
          error: msg,
          rowsWritten: 0,
        });
      }
    } else {
      summary.internalOk++;
    }

    // GA4 — re-fetch trailing 3 days when verified
    if (t.ga4_property_id?.trim() && t.ga4_verified_at) {
      try {
        const { days, details } = await fetchGa4DailyMetrics({
          propertyId: t.ga4_property_id,
          from: ga4From,
          to: yesterday,
        });
        for (const day of days) {
          await upsertGa4Day({
            tenantId: Number(t.id),
            date: day.date,
            sessions: day.sessions,
            users: day.users,
            newUsers: day.newUsers,
            pageviews: day.pageviews,
            engagedSessions: day.engagedSessions,
          });
        }
        for (const d of details) {
          await upsertGa4Detail({
            tenantId: Number(t.id),
            date: d.date,
            topPages: d.topPages,
            topSources: d.topSources,
          });
        }
        await logSync({
          tenantId: Number(t.id),
          source: "ga4",
          periodStart: ga4From,
          periodEnd: yesterday,
          ok: true,
          error: null,
          rowsWritten: days.length,
        });
        await clearGa4Failures(Number(t.id));
        summary.ga4Ok++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        summary.errors.push(`${t.slug} ga4: ${msg}`);
        await logSync({
          tenantId: Number(t.id),
          source: "ga4",
          periodStart: ga4From,
          periodEnd: yesterday,
          ok: false,
          error: msg,
          rowsWritten: 0,
        });
        await recordGa4Failure(Number(t.id), t.slug);
      }
    }
  }

  const pruned = await execute(
    `DELETE FROM analytics_daily_detail
     WHERE date < DATE_SUB(UTC_DATE(), INTERVAL 24 MONTH)`,
  );
  summary.prunedDetailRows = pruned.affectedRows;

  return summary;
}
