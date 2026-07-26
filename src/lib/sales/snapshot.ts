import type { RowDataPacket } from "mysql2/promise";
import { query } from "@/lib/db/pool";
import { getTenantGrossSales } from "@/lib/sales/gross-sales";
import {
  previousSastMonth,
  sastMonthOf,
  sastMonthWindow,
  type SastMonth,
} from "@/lib/sales/period";

export type SnapshotSummary = {
  month: string;
  tenants: number;
  ok: number;
  failed: number;
  errors: string[];
};

/**
 * Resolve and cache gross sales for one closed month across all live tenants.
 *
 * Failures are recorded per tenant rather than aborting the run: a tenant whose
 * deployment is down must not stop the other figures being captured, and the
 * failure is persisted so the billing run flags it.
 */
export async function runMonthlySalesSnapshot(
  month: SastMonth = previousSastMonth(sastMonthOf()),
): Promise<SnapshotSummary> {
  const window = sastMonthWindow(month.year, month.month);
  const tenants = await query<
    (RowDataPacket & { id: number; slug: string })[]
  >(
    `SELECT id, slug FROM tenants
     WHERE status IN ('active', 'suspended')
     ORDER BY trading_name`,
  );

  const summary: SnapshotSummary = {
    month: window.label,
    tenants: tenants.length,
    ok: 0,
    failed: 0,
    errors: [],
  };

  for (const t of tenants) {
    const result = await getTenantGrossSales(
      Number(t.id),
      month.year,
      month.month,
    );
    if (result.ok) {
      summary.ok++;
    } else {
      summary.failed++;
      summary.errors.push(`${t.slug}: ${result.error}`);
    }
  }

  return summary;
}
