/**
 * "The business at a glance" — read-only aggregation for the main dashboard.
 * No billing logic lives here: every number is derived from data other code owns.
 */

import type { RowDataPacket } from "mysql2/promise";
import { sastToday } from "@/lib/billing/cycle";
import { query } from "@/lib/db/pool";
import { previousSastMonth, sastMonthOf, sastMonthWindow } from "@/lib/sales/period";
import { CAPACITY_WARN_PCT } from "@/lib/servers/constants";

export type PaymentStanding = "current" | "overdue" | "unbilled";

export type LifecycleRow = {
  tenantId: number;
  slug: string;
  tradingName: string;
  status: string;
  planCode: string | null;
  planName: string | null;
  commissionRate: number;
  mrrCents: number;
  /** Gross sales for the most recent closed month. Null = never read. */
  salesGrossCents: number | null;
  salesOk: boolean | null;
  salesSource: string | null;
  standing: PaymentStanding;
  outstandingCents: number;
  overdueCount: number;
  server: string | null;
  graduationFlagId: number | null;
  graduationSavingCents: number | null;
};

export type LifecycleSummary = {
  activeTenants: number;
  suspendedTenants: number;
  mrrCents: number;
  overdueTenants: number;
  outstandingCents: number;
  flatRevenueCents: number;
  commissionRevenueCents: number;
  salesMonthLabel: string;
  billingMonthLabel: string;
  missingSalesCount: number;
  openGraduationFlags: number;
  serversOverWarn: number;
  byPlan: { planCode: string; planName: string; count: number }[];
};

export type LifecycleView = {
  summary: LifecycleSummary;
  rows: LifecycleRow[];
  servers: string[];
  plans: { code: string; name: string }[];
};

type Row = RowDataPacket & {
  id: number;
  slug: string;
  trading_name: string;
  status: string;
  plan_code: string | null;
  plan_name: string | null;
  commission_rate: string | number | null;
  plan_mrr: number | null;
  addon_mrr: number | null;
  sales_gross: number | null;
  sales_ok: number | null;
  sales_source: string | null;
  outstanding: number | null;
  overdue_count: number;
  host: string | null;
  flag_id: number | null;
  flag_saving: number | null;
};

export async function getLifecycleView(): Promise<LifecycleView> {
  const today = sastToday();
  const billingMonth = sastMonthOf();
  const salesMonth = previousSastMonth(billingMonth);
  const salesWindow = sastMonthWindow(salesMonth.year, salesMonth.month);
  const billingWindow = sastMonthWindow(billingMonth.year, billingMonth.month);

  const rows = await query<Row[]>(
    `SELECT
       t.id, t.slug, t.trading_name, t.status,
       s.plan_code, p.name AS plan_name,
       COALESCE(p.commission_rate, 0) AS commission_rate,
       s.current_monthly_cents AS plan_mrr,
       (
         SELECT COALESCE(SUM(a.amount_cents), 0) FROM addons a
         WHERE a.tenant_id = t.id AND a.kind = 'recurring'
           AND a.active_from <= :today
           AND (a.active_until IS NULL OR a.active_until >= :today)
       ) AS addon_mrr,
       sm.gross_cents AS sales_gross,
       sm.ok AS sales_ok,
       sm.source AS sales_source,
       (
         SELECT COALESCE(SUM(
           i.total_cents - COALESCE(
             (SELECT SUM(pay.amount_cents) FROM payments pay WHERE pay.invoice_id = i.id), 0)
         ), 0)
         FROM invoices i
         WHERE i.tenant_id = t.id AND i.status IN ('issued', 'overdue')
       ) AS outstanding,
       (
         SELECT COUNT(*) FROM invoices i
         WHERE i.tenant_id = t.id AND i.status = 'overdue'
       ) AS overdue_count,
       ti.host,
       g.id AS flag_id,
       g.saving_cents AS flag_saving
     FROM tenants t
     LEFT JOIN subscriptions s ON s.id = (
       SELECT s2.id FROM subscriptions s2
       WHERE s2.tenant_id = t.id AND s2.status = 'active'
         AND s2.started_on <= :today
         AND (s2.ends_on IS NULL OR s2.ends_on >= :today)
       ORDER BY s2.started_on DESC, s2.id DESC LIMIT 1
     )
     LEFT JOIN plans p ON p.code = s.plan_code
     LEFT JOIN tenant_infra ti ON ti.tenant_id = t.id
     LEFT JOIN tenant_sales_monthly sm
       ON sm.tenant_id = t.id
      AND sm.period_year = :salesYear AND sm.period_month = :salesMonth
     LEFT JOIN graduation_flags g ON g.id = (
       SELECT g2.id FROM graduation_flags g2
       WHERE g2.tenant_id = t.id AND g2.status = 'open'
       ORDER BY g2.detected_at DESC LIMIT 1
     )
     WHERE t.status IN ('active', 'suspended')
     ORDER BY t.trading_name`,
    {
      today,
      salesYear: salesMonth.year,
      salesMonth: salesMonth.month,
    },
  );

  const billed = await query<
    (RowDataPacket & { commission: number | null; total: number | null })[]
  >(
    `SELECT COALESCE(SUM(commission_cents), 0) AS commission,
            COALESCE(SUM(total_cents), 0) AS total
     FROM invoices
     WHERE status IN ('issued', 'paid', 'overdue')
       AND period_start = :monthStart`,
    { monthStart: billingWindow.periodStart },
  );

  const serverLoad = await query<
    (RowDataPacket & { host: string; used: number; capacity: number | null })[]
  >(
    `SELECT ti.host, COUNT(*) AS used, sv.capacity
     FROM tenant_infra ti
     INNER JOIN tenants t ON t.id = ti.tenant_id
     LEFT JOIN servers sv ON sv.name = ti.host
     WHERE t.status IN ('active', 'suspended')
     GROUP BY ti.host, sv.capacity`,
  );

  const mapped: LifecycleRow[] = rows.map((r) => {
    const overdueCount = Number(r.overdue_count ?? 0);
    const outstanding = Math.max(0, Number(r.outstanding ?? 0));
    const salesOk = r.sales_ok === null ? null : Boolean(r.sales_ok);
    return {
      tenantId: Number(r.id),
      slug: r.slug,
      tradingName: r.trading_name,
      status: r.status,
      planCode: r.plan_code,
      planName: r.plan_name,
      commissionRate: Number(r.commission_rate ?? 0),
      mrrCents: Number(r.plan_mrr ?? 0) + Number(r.addon_mrr ?? 0),
      salesGrossCents:
        salesOk && r.sales_gross !== null ? Number(r.sales_gross) : null,
      salesOk,
      salesSource: r.sales_source,
      standing:
        overdueCount > 0
          ? "overdue"
          : outstanding > 0
            ? "current"
            : "unbilled",
      outstandingCents: outstanding,
      overdueCount,
      server: r.host,
      graduationFlagId: r.flag_id === null ? null : Number(r.flag_id),
      graduationSavingCents:
        r.flag_saving === null ? null : Number(r.flag_saving),
    };
  });

  const totalBilled = Number(billed[0]?.total ?? 0);
  const commissionBilled = Number(billed[0]?.commission ?? 0);

  const byPlanMap = new Map<string, { planName: string; count: number }>();
  for (const row of mapped) {
    if (row.status !== "active") continue;
    const code = row.planCode ?? "none";
    const entry = byPlanMap.get(code) ?? {
      planName: row.planName ?? "No plan",
      count: 0,
    };
    entry.count++;
    byPlanMap.set(code, entry);
  }

  return {
    summary: {
      activeTenants: mapped.filter((r) => r.status === "active").length,
      suspendedTenants: mapped.filter((r) => r.status === "suspended").length,
      mrrCents: mapped
        .filter((r) => r.status === "active")
        .reduce((s, r) => s + r.mrrCents, 0),
      overdueTenants: mapped.filter((r) => r.standing === "overdue").length,
      outstandingCents: mapped.reduce((s, r) => s + r.outstandingCents, 0),
      flatRevenueCents: totalBilled - commissionBilled,
      commissionRevenueCents: commissionBilled,
      salesMonthLabel: salesWindow.label,
      billingMonthLabel: billingWindow.label,
      missingSalesCount: mapped.filter(
        (r) => r.commissionRate > 0 && r.salesGrossCents === null,
      ).length,
      openGraduationFlags: mapped.filter((r) => r.graduationFlagId !== null)
        .length,
      serversOverWarn: serverLoad.filter((s) => {
        const capacity = Number(s.capacity ?? 0);
        if (capacity <= 0) return false;
        return (Number(s.used) / capacity) * 100 >= CAPACITY_WARN_PCT;
      }).length,
      byPlan: [...byPlanMap.entries()].map(([planCode, v]) => ({
        planCode,
        planName: v.planName,
        count: v.count,
      })),
    },
    rows: mapped,
    servers: [
      ...new Set(mapped.map((r) => r.server).filter((s): s is string => !!s)),
    ].sort(),
    plans: [
      ...new Map(
        mapped
          .filter((r) => r.planCode)
          .map((r) => [r.planCode!, r.planName ?? r.planCode!]),
      ).entries(),
    ].map(([code, name]) => ({ code, name })),
  };
}
