/**
 * Revenue analytics, read-only over invoices, subscriptions and tenants.
 *
 * Two different things are measured here and they must not be conflated:
 *   - MRR is *contracted* recurring revenue right now, from subscriptions.
 *   - Billed revenue is what was actually invoiced in a month, from invoices.
 * Commission is variable, so it appears in billed revenue but never in MRR.
 */

import type { RowDataPacket } from "mysql2/promise";
import { sastToday } from "@/lib/billing/cycle";
import { query } from "@/lib/db/pool";
import { sastMonthOf, sastMonthWindow } from "@/lib/sales/period";

const BILLABLE = "('issued', 'paid', 'overdue')";

export type PlanBreakdownRow = {
  planCode: string;
  planName: string;
  tenantCount: number;
  mrrCents: number;
  commissionRate: number;
};

export type MonthRevenueRow = {
  /** YYYY-MM-01 */
  monthStart: string;
  label: string;
  flatCents: number;
  commissionCents: number;
  totalCents: number;
  invoiceCount: number;
};

export type TenantRevenueRow = {
  tenantId: number;
  slug: string;
  tradingName: string;
  planName: string | null;
  mrrCents: number;
  billedThisMonthCents: number;
  commissionThisMonthCents: number;
};

export type ChurnRow = {
  tenantId: number;
  slug: string;
  tradingName: string;
  planName: string | null;
  offboardedOn: string;
  lostMrrCents: number;
};

export type RevenueOverview = {
  mrrCents: number;
  arrCents: number;
  previousMrrCents: number;
  momGrowthPct: number | null;
  activeTenants: number;
  thisMonth: MonthRevenueRow | null;
  planBreakdown: PlanBreakdownRow[];
  trend: MonthRevenueRow[];
  perTenant: TenantRevenueRow[];
  churn: ChurnRow[];
  churnedMrrCents: number;
};

function monthLabel(monthStart: string): string {
  const [y, m] = monthStart.slice(0, 10).split("-").map(Number);
  return sastMonthWindow(y!, m!).label;
}

/** Contracted MRR: active tenants' subscription price + recurring addons. */
async function currentMrrCents(today: string): Promise<number> {
  const rows = await query<(RowDataPacket & { total: number })[]>(
    `SELECT COALESCE(SUM(x.amount), 0) AS total FROM (
       SELECT s.current_monthly_cents AS amount
       FROM tenants t
       INNER JOIN subscriptions s ON s.id = (
         SELECT s2.id FROM subscriptions s2
         WHERE s2.tenant_id = t.id AND s2.status = 'active'
           AND s2.started_on <= :today
           AND (s2.ends_on IS NULL OR s2.ends_on >= :today)
         ORDER BY s2.started_on DESC, s2.id DESC LIMIT 1
       )
       WHERE t.status = 'active'
       UNION ALL
       SELECT a.amount_cents AS amount
       FROM tenants t
       INNER JOIN addons a ON a.tenant_id = t.id
       WHERE t.status = 'active'
         AND a.kind = 'recurring'
         AND a.active_from <= :today
         AND (a.active_until IS NULL OR a.active_until >= :today)
     ) x`,
    { today },
  );
  return Number(rows[0]?.total ?? 0);
}

async function billedByMonth(months: number): Promise<MonthRevenueRow[]> {
  const rows = await query<
    (RowDataPacket & {
      month_start: string;
      commission: number | null;
      total: number | null;
      invoice_count: number;
    })[]
  >(
    `SELECT DATE_FORMAT(i.period_start, '%Y-%m-01') AS month_start,
            COALESCE(SUM(i.commission_cents), 0) AS commission,
            COALESCE(SUM(i.total_cents), 0) AS total,
            COUNT(*) AS invoice_count
     FROM invoices i
     WHERE i.status IN ${BILLABLE}
       AND i.period_start >= DATE_SUB(
             DATE_FORMAT(:today, '%Y-%m-01'), INTERVAL ${Math.max(1, Math.min(36, Math.trunc(months)))} MONTH)
     GROUP BY month_start
     ORDER BY month_start`,
    { today: sastToday() },
  );

  return rows.map((r) => {
    const monthStart = String(r.month_start).slice(0, 10);
    const commission = Number(r.commission ?? 0);
    const total = Number(r.total ?? 0);
    return {
      monthStart,
      label: monthLabel(monthStart),
      commissionCents: commission,
      flatCents: total - commission,
      totalCents: total,
      invoiceCount: Number(r.invoice_count),
    };
  });
}

export async function getRevenueOverview(
  trendMonths = 12,
): Promise<RevenueOverview> {
  const today = sastToday();
  const thisMonth = sastMonthOf();
  const thisWindow = sastMonthWindow(thisMonth.year, thisMonth.month);

  const [mrrCents, trend, plans, perTenant, churn, activeCount] =
    await Promise.all([
      currentMrrCents(today),
      billedByMonth(trendMonths),
      query<
        (RowDataPacket & {
          code: string;
          name: string;
          commission_rate: string | number;
          tenant_count: number;
          mrr: number | null;
        })[]
      >(
        `SELECT p.code, p.name, p.commission_rate,
                COUNT(DISTINCT t.id) AS tenant_count,
                COALESCE(SUM(s.current_monthly_cents), 0) AS mrr
         FROM plans p
         LEFT JOIN subscriptions s
           ON s.plan_code = p.code AND s.status = 'active'
         LEFT JOIN tenants t
           ON t.id = s.tenant_id AND t.status = 'active'
         GROUP BY p.code, p.name, p.commission_rate, p.sort_order
         ORDER BY p.sort_order, p.name`,
      ),
      query<
        (RowDataPacket & {
          id: number;
          slug: string;
          trading_name: string;
          plan_name: string | null;
          plan_mrr: number | null;
          addon_mrr: number | null;
          billed: number | null;
          commission: number | null;
        })[]
      >(
        `SELECT t.id, t.slug, t.trading_name,
                p.name AS plan_name,
                s.current_monthly_cents AS plan_mrr,
                (
                  SELECT COALESCE(SUM(a.amount_cents), 0) FROM addons a
                  WHERE a.tenant_id = t.id AND a.kind = 'recurring'
                    AND a.active_from <= :today
                    AND (a.active_until IS NULL OR a.active_until >= :today)
                ) AS addon_mrr,
                (
                  SELECT COALESCE(SUM(i.total_cents), 0) FROM invoices i
                  WHERE i.tenant_id = t.id AND i.status IN ${BILLABLE}
                    AND i.period_start = :monthStart
                ) AS billed,
                (
                  SELECT COALESCE(SUM(i.commission_cents), 0) FROM invoices i
                  WHERE i.tenant_id = t.id AND i.status IN ${BILLABLE}
                    AND i.period_start = :monthStart
                ) AS commission
         FROM tenants t
         LEFT JOIN subscriptions s ON s.id = (
           SELECT s2.id FROM subscriptions s2
           WHERE s2.tenant_id = t.id AND s2.status = 'active'
             AND s2.started_on <= :today
             AND (s2.ends_on IS NULL OR s2.ends_on >= :today)
           ORDER BY s2.started_on DESC, s2.id DESC LIMIT 1
         )
         LEFT JOIN plans p ON p.code = s.plan_code
         WHERE t.status = 'active'
         ORDER BY (COALESCE(s.current_monthly_cents, 0)) DESC, t.trading_name`,
        { today, monthStart: thisWindow.periodStart },
      ),
      query<
        (RowDataPacket & {
          id: number;
          slug: string;
          trading_name: string;
          plan_name: string | null;
          offboarded_on: string;
          lost_mrr: number | null;
        })[]
      >(
        `SELECT t.id, t.slug, t.trading_name,
                p.name AS plan_name,
                DATE(t.offboarded_at) AS offboarded_on,
                s.current_monthly_cents AS lost_mrr
         FROM tenants t
         LEFT JOIN subscriptions s ON s.id = (
           SELECT s2.id FROM subscriptions s2
           WHERE s2.tenant_id = t.id
           ORDER BY s2.started_on DESC, s2.id DESC LIMIT 1
         )
         LEFT JOIN plans p ON p.code = s.plan_code
         WHERE t.status = 'offboarded'
           AND t.offboarded_at IS NOT NULL
           AND DATE(t.offboarded_at) BETWEEN :monthStart AND :monthEnd
         ORDER BY t.offboarded_at DESC`,
        { monthStart: thisWindow.periodStart, monthEnd: thisWindow.periodEnd },
      ),
      query<(RowDataPacket & { c: number })[]>(
        `SELECT COUNT(*) AS c FROM tenants WHERE status = 'active'`,
      ),
    ]);

  const current = trend.find((m) => m.monthStart === thisWindow.periodStart) ?? null;
  const previousBilled = trend[trend.length - 2] ?? null;
  const currentBilled = trend[trend.length - 1] ?? null;

  // MoM growth compares *billed* months, because a historical MRR snapshot
  // does not exist — subscriptions only carry their current price.
  const previousMrrCents = previousBilled
    ? previousBilled.flatCents
    : 0;
  const momGrowthPct =
    previousBilled && previousBilled.flatCents > 0 && currentBilled
      ? Math.round(
          ((currentBilled.flatCents - previousBilled.flatCents) /
            previousBilled.flatCents) *
            1000,
        ) / 10
      : null;

  return {
    mrrCents,
    arrCents: mrrCents * 12,
    previousMrrCents,
    momGrowthPct,
    activeTenants: Number(activeCount[0]?.c ?? 0),
    thisMonth: current,
    planBreakdown: plans.map((p) => ({
      planCode: p.code,
      planName: p.name,
      tenantCount: Number(p.tenant_count ?? 0),
      mrrCents: Number(p.mrr ?? 0),
      commissionRate: Number(p.commission_rate ?? 0),
    })),
    trend,
    perTenant: perTenant.map((t) => ({
      tenantId: Number(t.id),
      slug: t.slug,
      tradingName: t.trading_name,
      planName: t.plan_name,
      mrrCents: Number(t.plan_mrr ?? 0) + Number(t.addon_mrr ?? 0),
      billedThisMonthCents: Number(t.billed ?? 0),
      commissionThisMonthCents: Number(t.commission ?? 0),
    })),
    churn: churn.map((c) => ({
      tenantId: Number(c.id),
      slug: c.slug,
      tradingName: c.trading_name,
      planName: c.plan_name,
      offboardedOn: String(c.offboarded_on).slice(0, 10),
      lostMrrCents: Number(c.lost_mrr ?? 0),
    })),
    churnedMrrCents: churn.reduce((s, c) => s + Number(c.lost_mrr ?? 0), 0),
  };
}
