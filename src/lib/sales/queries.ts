import type { RowDataPacket } from "mysql2/promise";
import { query } from "@/lib/db/pool";
import { sastMonthWindow } from "@/lib/sales/period";

export type MonthlySalesRow = {
  tenantId: number;
  periodStart: string;
  periodEnd: string;
  grossCents: number | null;
  orderCount: number | null;
  source: string;
  ok: boolean;
  error: string | null;
  fetchedAt: string;
};

type Row = RowDataPacket & {
  tenant_id: number;
  period_start: string;
  period_end: string;
  gross_cents: number | null;
  order_count: number | null;
  source: string;
  ok: number;
  error: string | null;
  fetched_at: string;
};

function mapRow(r: Row): MonthlySalesRow {
  return {
    tenantId: Number(r.tenant_id),
    periodStart: String(r.period_start).slice(0, 10),
    periodEnd: String(r.period_end).slice(0, 10),
    grossCents: r.gross_cents === null ? null : Number(r.gross_cents),
    orderCount: r.order_count === null ? null : Number(r.order_count),
    source: r.source,
    ok: Boolean(r.ok),
    error: r.error,
    fetchedAt: String(r.fetched_at),
  };
}

/** Cached sales figures for one month, keyed by tenant id. */
export async function salesForMonth(
  year: number,
  month: number,
): Promise<Map<number, MonthlySalesRow>> {
  const rows = await query<Row[]>(
    `SELECT tenant_id, period_start, period_end, gross_cents, order_count,
            source, ok, error, fetched_at
     FROM tenant_sales_monthly
     WHERE period_year = :year AND period_month = :month`,
    { year, month },
  );
  return new Map(rows.map((r) => [Number(r.tenant_id), mapRow(r)]));
}

/** Most recent `count` months of cached sales for one tenant, newest first. */
export async function recentSalesForTenant(
  tenantId: number,
  count = 12,
): Promise<MonthlySalesRow[]> {
  const rows = await query<Row[]>(
    `SELECT tenant_id, period_start, period_end, gross_cents, order_count,
            source, ok, error, fetched_at
     FROM tenant_sales_monthly
     WHERE tenant_id = :tenantId
     ORDER BY period_year DESC, period_month DESC
     LIMIT ${Math.max(1, Math.min(60, Math.trunc(count)))}`,
    { tenantId },
  );
  return rows.map(mapRow);
}

export async function salesForTenantMonth(
  tenantId: number,
  year: number,
  month: number,
): Promise<MonthlySalesRow | null> {
  sastMonthWindow(year, month); // rejects an out-of-range month before querying
  const rows = await query<Row[]>(
    `SELECT tenant_id, period_start, period_end, gross_cents, order_count,
            source, ok, error, fetched_at
     FROM tenant_sales_monthly
     WHERE tenant_id = :tenantId AND period_year = :year AND period_month = :month
     LIMIT 1`,
    { tenantId, year, month },
  );
  const row = rows[0];
  return row ? mapRow(row) : null;
}
