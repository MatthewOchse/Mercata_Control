/**
 * Monthly GROSS sales per tenant — the basis for commission billing.
 *
 * GROSS is defined as: the total value of completed sale transactions dated
 * inside the SAST calendar month, BEFORE deducting refunds, returns or
 * cancellations. All sale channels count (online web orders, POS cash, POS
 * card, and on-account sales) because commission is levied on the tenant's
 * whole turnover through the platform. Account *payments* and refunds are not
 * sales and are excluded. See SALES_DEFINITION.md for the contract wording and
 * the exact transaction types.
 *
 * Hard rule: this module NEVER reports zero because a figure could not be
 * read. A genuine zero-sales month returns ok:true with 0; an unreadable
 * tenant returns ok:false so the operator is forced to look. Silently
 * defaulting to 0 would under-bill and hide the failure.
 */

import type { RowDataPacket } from "mysql2/promise";
import { query, execute } from "@/lib/db/pool";
import { fleetAnalyticsSource } from "@/lib/digest/sources/fleet";
import {
  daysInMonth,
  sastMonthWindow,
  isMonthClosed,
  type SastMonth,
} from "@/lib/sales/period";

export type GrossSalesSource = "fleet" | "warehouse" | "manual" | "cached";

export type GrossSalesOk = {
  ok: true;
  tenantId: number;
  /** Integer cents, ZAR. Repo invariant: money is never a float. */
  grossSalesCents: number;
  orderCount: number;
  currency: "ZAR";
  periodStart: string;
  periodEnd: string;
  source: GrossSalesSource;
  /** True when the month had not ended in SAST at read time (partial figure). */
  partial: boolean;
};

export type GrossSalesError = {
  ok: false;
  tenantId: number;
  currency: "ZAR";
  periodStart: string;
  periodEnd: string;
  source: "unavailable";
  error: string;
};

export type GrossSalesResult = GrossSalesOk | GrossSalesError;

type InfraRow = RowDataPacket & {
  primary_domain: string | null;
  fleet_secret: string | null;
  slug: string;
};

async function loadFleetTarget(tenantId: number): Promise<{
  slug: string;
  primaryDomain: string;
  fleetSecretCipher: string;
} | null> {
  const rows = await query<InfraRow[]>(
    `SELECT t.slug, ti.primary_domain, ti.fleet_secret
     FROM tenants t
     LEFT JOIN tenant_infra ti ON ti.tenant_id = t.id
     WHERE t.id = :tenantId
     LIMIT 1`,
    { tenantId },
  );
  const row = rows[0];
  if (!row?.primary_domain || !row.fleet_secret) return null;
  return {
    slug: row.slug,
    primaryDomain: row.primary_domain,
    fleetSecretCipher: row.fleet_secret,
  };
}

/**
 * Warehouse fallback. `analytics_daily` is populated nightly from the same
 * fleet endpoint, but buckets by UTC day, so month edges can be off by the
 * transactions between 00:00 and 02:00 SAST on the 1st. Only used when the
 * live call fails AND every day of the month is present, and the source is
 * reported as "warehouse" so the operator can see it was not measured live.
 */
async function warehouseGross(
  tenantId: number,
  periodStart: string,
  periodEnd: string,
  expectedDays: number,
): Promise<{ grossCents: number; orderCount: number } | null> {
  const rows = await query<
    (RowDataPacket & {
      days: number;
      gross: number | null;
      orders: number | null;
    })[]
  >(
    `SELECT COUNT(*) AS days,
            SUM(gross_cents) AS gross,
            SUM(orders) AS orders
     FROM analytics_daily
     WHERE tenant_id = :tenantId
       AND source = 'internal'
       AND \`date\` BETWEEN :periodStart AND :periodEnd
       AND gross_cents IS NOT NULL`,
    { tenantId, periodStart, periodEnd },
  );
  const row = rows[0];
  if (!row || Number(row.days) < expectedDays) return null;
  return {
    grossCents: Number(row.gross ?? 0),
    orderCount: Number(row.orders ?? 0),
  };
}

/**
 * A figure already resolved for this month, if any.
 *
 * Only consulted for closed months, where the gross is immutable — a figure
 * measured on the 1st is as true as one measured on the 8th. Two things depend
 * on this: the monthly snapshot job (which exists so billing does not have to
 * reach every storefront on billing day), and operator overrides, which must
 * never be silently overwritten by a later live read.
 */
async function cachedFigure(
  tenantId: number,
  month: SastMonth,
): Promise<{ grossCents: number; orderCount: number; manual: boolean } | null> {
  const rows = await query<
    (RowDataPacket & {
      gross_cents: number | null;
      order_count: number | null;
      source: string;
    })[]
  >(
    `SELECT gross_cents, order_count, source
     FROM tenant_sales_monthly
     WHERE tenant_id = :tenantId
       AND period_year = :year
       AND period_month = :month
       AND ok = 1
       AND gross_cents IS NOT NULL
     LIMIT 1`,
    { tenantId, year: month.year, month: month.month },
  );
  const row = rows[0];
  if (!row || row.gross_cents === null) return null;
  return {
    grossCents: Number(row.gross_cents),
    orderCount: Number(row.order_count ?? 0),
    manual: row.source === "manual",
  };
}

/**
 * Persist the outcome for audit, so an issued invoice can always be re-explained.
 *
 * A failed read must never destroy a figure we already hold: the monthly
 * snapshot captures the month on the 1st, and a storefront that goes down
 * afterwards would otherwise wipe the basis for an invoice that is already
 * correct. So a failure only records its error text, leaving any good figure
 * standing — a row with `ok = 1` and a non-null `error` means "we have the
 * month, but the most recent attempt to re-read it failed".
 */
async function recordSalesFigure(
  tenantId: number,
  window: { periodStart: string; periodEnd: string },
  month: SastMonth,
  result: GrossSalesResult,
): Promise<void> {
  await execute(
    `INSERT INTO tenant_sales_monthly
       (tenant_id, period_year, period_month, period_start, period_end,
        gross_cents, order_count, currency, source, ok, error)
     VALUES
       (:tenantId, :year, :month, :periodStart, :periodEnd,
        :grossCents, :orderCount, 'ZAR', :source, :ok, :error)
     ON DUPLICATE KEY UPDATE
       gross_cents = IF(VALUES(ok) = 1, VALUES(gross_cents), gross_cents),
       order_count = IF(VALUES(ok) = 1, VALUES(order_count), order_count),
       source      = IF(VALUES(ok) = 1, VALUES(source), source),
       ok          = GREATEST(ok, VALUES(ok)),
       error       = VALUES(error)`,
    {
      tenantId,
      year: month.year,
      month: month.month,
      periodStart: window.periodStart,
      periodEnd: window.periodEnd,
      grossCents: result.ok ? result.grossSalesCents : null,
      orderCount: result.ok ? result.orderCount : null,
      source: result.source,
      ok: result.ok ? 1 : 0,
      error: result.ok ? null : result.error,
    },
  );
}

/**
 * Gross sales for a tenant in one SAST calendar month.
 *
 * Resolution order, for a closed month:
 *   1. an operator's manual figure — a human decision outranks a machine read
 *   2. the live fleet endpoint — authoritative while the deployment is up
 *   3. a figure already resolved for this month (the monthly snapshot job), so
 *      billing does not break when a storefront happens to be down
 *   4. the warehouse, if it covers every day of the month
 *
 * An open month always reads live, since the figure is still moving.
 * Everything failing is an explicit error state, never 0. The outcome is
 * persisted to `tenant_sales_monthly` so an issued invoice can be re-explained.
 */
export async function getTenantGrossSales(
  tenantId: number,
  year: number,
  month: number,
  opts: { persist?: boolean } = {},
): Promise<GrossSalesResult> {
  const persist = opts.persist !== false;
  const window = sastMonthWindow(year, month);
  const base = {
    tenantId,
    currency: "ZAR" as const,
    periodStart: window.periodStart,
    periodEnd: window.periodEnd,
  };
  const partial = !isMonthClosed({ year, month });

  const finish = async (result: GrossSalesResult): Promise<GrossSalesResult> => {
    if (persist) {
      try {
        await recordSalesFigure(tenantId, window, { year, month }, result);
      } catch {
        // Persisting is for audit only — never turn a good figure into a failure.
      }
    }
    return result;
  };

  // A closed month cannot change, so an already-resolved figure stays valid.
  const cached = partial ? null : await cachedFigure(tenantId, { year, month });

  if (cached?.manual) {
    return {
      ...base,
      ok: true,
      grossSalesCents: cached.grossCents,
      orderCount: cached.orderCount,
      source: "manual",
      partial: false,
    };
  }

  const target = await loadFleetTarget(tenantId);
  let fleetError = "Tenant has no primary domain or fleet secret on record";

  if (target) {
    try {
      const sales = await fleetAnalyticsSource.fetchSales({
        tenantId,
        slug: target.slug,
        primaryDomain: target.primaryDomain,
        fleetSecretCipher: target.fleetSecretCipher,
        // Instants, not YYYY-MM-DD: the endpoint reads bare dates as UTC days.
        from: window.fromInstant,
        to: window.toInstantExclusive,
      });
      const grossSalesCents = Number(sales.grossSalesCents);
      if (!Number.isFinite(grossSalesCents) || grossSalesCents < 0) {
        throw new Error(
          `Fleet returned an unusable gross figure: ${sales.grossSalesCents}`,
        );
      }
      return finish({
        ...base,
        ok: true,
        grossSalesCents: Math.trunc(grossSalesCents),
        orderCount: Number(sales.ordersCount ?? 0),
        source: "fleet",
        partial,
      });
    } catch (err) {
      fleetError = err instanceof Error ? err.message : "Fleet stats failed";
    }
  }

  if (cached) {
    return {
      ...base,
      ok: true,
      grossSalesCents: cached.grossCents,
      orderCount: cached.orderCount,
      source: "cached",
      partial: false,
    };
  }

  const wh = await warehouseGross(
    tenantId,
    window.periodStart,
    window.periodEnd,
    daysInMonth(year, month),
  ).catch(() => null);

  if (wh) {
    return finish({
      ...base,
      ok: true,
      grossSalesCents: Math.trunc(wh.grossCents),
      orderCount: wh.orderCount,
      source: "warehouse",
      partial,
    });
  }

  return finish({
    ...base,
    ok: false,
    source: "unavailable",
    error: `${fleetError}. Warehouse has no complete ${window.label} coverage either.`,
  });
}

/** Commission in cents. Rounds half-up on the final cent, integer maths only. */
export function commissionCents(
  grossSalesCents: number,
  rate: number,
): number {
  if (!Number.isInteger(grossSalesCents)) {
    throw new Error(
      `commissionCents expects integer cents, got ${grossSalesCents}`,
    );
  }
  if (!Number.isFinite(rate) || rate < 0 || rate > 1) {
    throw new Error(`Invalid commission rate: ${rate}`);
  }
  // rate carries 4 decimals (DECIMAL(6,4)) — scale to integers before dividing.
  const scaledRate = Math.round(rate * 10000);
  return Math.trunc((grossSalesCents * scaledRate + 5000) / 10000);
}
