/**
 * Starter → flat-tier graduation monitor.
 *
 * NOTIFY ONLY. Nothing here changes a tenant's plan, and nothing here touches
 * an invoice. It raises a persistent flag when a commission tenant has out-grown
 * commission pricing for two consecutive months, so the operator can offer them
 * the cheaper flat tier. The plan change itself stays a human decision, applied
 * through the normal package-change path (effective next cycle, never backdated).
 */

import type { RowDataPacket } from "mysql2/promise";
import { writeAuditLog } from "@/lib/db/audit";
import { execute, query, withTransaction } from "@/lib/db/pool";
import { commissionCents, getTenantGrossSales } from "@/lib/sales/gross-sales";
import {
  previousSastMonth,
  sastMonthOf,
  sastMonthWindow,
  type SastMonth,
} from "@/lib/sales/period";

export type GraduationFlag = {
  id: number;
  tenantId: number;
  slug: string;
  tradingName: string;
  fromPlanCode: string;
  fromPlanName: string;
  suggestedPlanCode: string;
  suggestedPlanName: string;
  thresholdCents: number;
  month1Start: string;
  month1Label: string;
  month1GrossCents: number;
  month2Start: string;
  month2Label: string;
  month2GrossCents: number;
  starterCostCents: number;
  flatCostCents: number;
  savingCents: number;
  status: "open" | "dismissed" | "graduated";
  detectedAt: string;
};

type FlagRow = RowDataPacket & {
  id: number;
  tenant_id: number;
  slug: string;
  trading_name: string;
  from_plan_code: string;
  from_plan_name: string | null;
  suggested_plan_code: string;
  suggested_plan_name: string | null;
  threshold_cents: number;
  month1_start: string;
  month1_gross_cents: number;
  month2_start: string;
  month2_gross_cents: number;
  starter_cost_cents: number;
  flat_cost_cents: number;
  saving_cents: number;
  status: "open" | "dismissed" | "graduated";
  detected_at: string;
};

function monthLabel(isoDate: string): string {
  const [y, m] = isoDate.slice(0, 10).split("-").map(Number);
  return sastMonthWindow(y!, m!).label;
}

function mapFlag(r: FlagRow): GraduationFlag {
  const month1Start = String(r.month1_start).slice(0, 10);
  const month2Start = String(r.month2_start).slice(0, 10);
  return {
    id: Number(r.id),
    tenantId: Number(r.tenant_id),
    slug: r.slug,
    tradingName: r.trading_name,
    fromPlanCode: r.from_plan_code,
    fromPlanName: r.from_plan_name ?? r.from_plan_code,
    suggestedPlanCode: r.suggested_plan_code,
    suggestedPlanName: r.suggested_plan_name ?? r.suggested_plan_code,
    thresholdCents: Number(r.threshold_cents),
    month1Start,
    month1Label: monthLabel(month1Start),
    month1GrossCents: Number(r.month1_gross_cents),
    month2Start,
    month2Label: monthLabel(month2Start),
    month2GrossCents: Number(r.month2_gross_cents),
    starterCostCents: Number(r.starter_cost_cents),
    flatCostCents: Number(r.flat_cost_cents),
    savingCents: Number(r.saving_cents),
    status: r.status,
    detectedAt: String(r.detected_at),
  };
}

const FLAG_SELECT = `
  SELECT g.id, g.tenant_id, t.slug, t.trading_name,
         g.from_plan_code, fp.name AS from_plan_name,
         g.suggested_plan_code, sp.name AS suggested_plan_name,
         g.threshold_cents, g.month1_start, g.month1_gross_cents,
         g.month2_start, g.month2_gross_cents,
         g.starter_cost_cents, g.flat_cost_cents, g.saving_cents,
         g.status, g.detected_at
  FROM graduation_flags g
  INNER JOIN tenants t ON t.id = g.tenant_id
  LEFT JOIN plans fp ON fp.code = g.from_plan_code
  LEFT JOIN plans sp ON sp.code = g.suggested_plan_code`;

export async function listOpenGraduationFlags(): Promise<GraduationFlag[]> {
  const rows = await query<FlagRow[]>(
    `${FLAG_SELECT} WHERE g.status = 'open' ORDER BY g.saving_cents DESC, g.detected_at`,
  );
  return rows.map(mapFlag);
}

export async function listGraduationFlagsForTenant(
  tenantId: number,
): Promise<GraduationFlag[]> {
  const rows = await query<FlagRow[]>(
    `${FLAG_SELECT} WHERE g.tenant_id = :tenantId ORDER BY g.month2_start DESC`,
    { tenantId },
  );
  return rows.map(mapFlag);
}

type Candidate = RowDataPacket & {
  tenant_id: number;
  slug: string;
  plan_code: string;
  base_cents: number;
  commission_rate: string | number;
  threshold_cents: number;
  graduate_to_code: string | null;
  flat_cents: number | null;
};

export type GraduationCheckSummary = {
  checked: number;
  flagged: number;
  skipped: number;
  errors: string[];
  months: { month1: string; month2: string };
};

/**
 * Monthly check. Runs after sales figures are in, over the two most recently
 * closed SAST months.
 */
export async function runGraduationCheck(
  now = new Date(),
): Promise<GraduationCheckSummary> {
  const month2 = previousSastMonth(sastMonthOf(now));
  const month1 = previousSastMonth(month2);
  const w1 = sastMonthWindow(month1.year, month1.month);
  const w2 = sastMonthWindow(month2.year, month2.month);

  const candidates = await query<Candidate[]>(
    `SELECT t.id AS tenant_id, t.slug, s.plan_code,
            s.current_monthly_cents AS base_cents,
            p.commission_rate, p.graduation_threshold_cents AS threshold_cents,
            p.graduate_to_code,
            gp.monthly_cents AS flat_cents
     FROM tenants t
     INNER JOIN subscriptions s ON s.id = (
       SELECT s2.id FROM subscriptions s2
       WHERE s2.tenant_id = t.id AND s2.status = 'active'
       ORDER BY s2.started_on DESC, s2.id DESC LIMIT 1
     )
     INNER JOIN plans p ON p.code = s.plan_code
     LEFT JOIN plans gp ON gp.code = p.graduate_to_code
     WHERE t.status = 'active'
       AND p.commission_rate > 0
       AND p.graduation_threshold_cents IS NOT NULL`,
  );

  const summary: GraduationCheckSummary = {
    checked: candidates.length,
    flagged: 0,
    skipped: 0,
    errors: [],
    months: { month1: w1.label, month2: w2.label },
  };

  for (const c of candidates) {
    const tenantId = Number(c.tenant_id);
    const threshold = Number(c.threshold_cents);
    try {
      const [s1, s2] = await Promise.all([
        getTenantGrossSales(tenantId, month1.year, month1.month),
        getTenantGrossSales(tenantId, month2.year, month2.month),
      ]);

      if (!s1.ok || !s2.ok) {
        summary.skipped++;
        summary.errors.push(
          `${c.slug}: sales unavailable (${!s1.ok ? w1.label : w2.label})`,
        );
        continue;
      }

      if (
        s1.grossSalesCents <= threshold ||
        s2.grossSalesCents <= threshold
      ) {
        continue;
      }

      const rate = Number(c.commission_rate);
      const baseCents = Number(c.base_cents);
      const starterCost =
        baseCents + commissionCents(s2.grossSalesCents, rate);
      const flatCost = Number(c.flat_cents ?? 0);
      const suggested = c.graduate_to_code;
      if (!suggested || !c.flat_cents) {
        summary.skipped++;
        summary.errors.push(
          `${c.slug}: plan ${c.plan_code} has no graduation target configured`,
        );
        continue;
      }

      const result = await execute(
        `INSERT INTO graduation_flags
           (tenant_id, from_plan_code, suggested_plan_code, threshold_cents,
            month1_start, month1_gross_cents, month2_start, month2_gross_cents,
            starter_cost_cents, flat_cost_cents, saving_cents, status)
         VALUES
           (:tenantId, :fromPlan, :toPlan, :threshold,
            :m1Start, :m1Gross, :m2Start, :m2Gross,
            :starterCost, :flatCost, :saving, 'open')
         ON DUPLICATE KEY UPDATE
           month1_gross_cents = VALUES(month1_gross_cents),
           month2_gross_cents = VALUES(month2_gross_cents),
           starter_cost_cents = VALUES(starter_cost_cents),
           flat_cost_cents = VALUES(flat_cost_cents),
           saving_cents = VALUES(saving_cents)`,
        {
          tenantId,
          fromPlan: c.plan_code,
          toPlan: suggested,
          threshold,
          m1Start: w1.periodStart,
          m1Gross: s1.grossSalesCents,
          m2Start: w2.periodStart,
          m2Gross: s2.grossSalesCents,
          starterCost,
          flatCost,
          saving: starterCost - flatCost,
        },
      );
      if (result.affectedRows === 1) summary.flagged++;
    } catch (err) {
      summary.skipped++;
      summary.errors.push(
        `${c.slug}: ${err instanceof Error ? err.message : "check failed"}`,
      );
    }
  }

  return summary;
}

export async function dismissGraduationFlag(
  flagId: number,
  actor: string,
): Promise<void> {
  await withTransaction(async (conn) => {
    const [rows] = await conn.execute<
      (RowDataPacket & { tenant_id: number; status: string })[]
    >(`SELECT tenant_id, status FROM graduation_flags WHERE id = ? LIMIT 1`, [
      flagId,
    ]);
    const flag = rows[0];
    if (!flag) throw new Error("Flag not found");
    if (flag.status !== "open") return;

    await conn.execute(
      `UPDATE graduation_flags
       SET status = 'dismissed', resolved_at = UTC_TIMESTAMP(3), resolved_by = ?
       WHERE id = ?`,
      [actor, flagId],
    );
    await writeAuditLog(conn, {
      actor,
      action: "graduation.dismissed",
      entityType: "graduation_flag",
      entityId: flagId,
      after: { tenant_id: Number(flag.tenant_id) },
    });
  });
}

/**
 * Record that a flagged tenant was moved to the flat tier. The plan change
 * itself happens through `changePlan` (effective next cycle) — this only closes
 * the flag and writes the who/when/from/to line into the audit log.
 */
export async function markGraduated(opts: {
  flagId: number;
  actor: string;
  fromPlanCode: string;
  toPlanCode: string;
  effectiveOn: string;
}): Promise<void> {
  await withTransaction(async (conn) => {
    const [rows] = await conn.execute<
      (RowDataPacket & { tenant_id: number })[]
    >(`SELECT tenant_id FROM graduation_flags WHERE id = ? LIMIT 1`, [
      opts.flagId,
    ]);
    const flag = rows[0];
    if (!flag) throw new Error("Flag not found");

    await conn.execute(
      `UPDATE graduation_flags
       SET status = 'graduated', resolved_at = UTC_TIMESTAMP(3), resolved_by = ?
       WHERE id = ?`,
      [opts.actor, opts.flagId],
    );
    await writeAuditLog(conn, {
      actor: opts.actor,
      action: "tenant.graduated",
      entityType: "tenant",
      entityId: Number(flag.tenant_id),
      before: { plan_code: opts.fromPlanCode },
      after: {
        plan_code: opts.toPlanCode,
        effective_on: opts.effectiveOn,
        graduation_flag_id: opts.flagId,
      },
    });
  });
}

/** Latest closed month pair, for display alongside the action list. */
export function graduationMonths(now = new Date()): {
  month1: SastMonth;
  month2: SastMonth;
} {
  const month2 = previousSastMonth(sastMonthOf(now));
  return { month1: previousSastMonth(month2), month2 };
}
