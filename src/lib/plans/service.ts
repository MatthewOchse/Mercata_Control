import type { RowDataPacket } from "mysql2/promise";
import { writeAuditLog } from "@/lib/db/audit";
import { withTransaction } from "@/lib/db/pool";

export type PlanUpdate = {
  code: string;
  name: string;
  monthlyCents: number;
  /** Fraction, e.g. 0.02 for 2%. Stored as DECIMAL(6,4). */
  commissionRate: number;
  graduationThresholdCents: number | null;
  graduateToCode: string | null;
  eligibility: string | null;
  active: boolean;
};

/**
 * Edit the plan catalog.
 *
 * This changes the *defaults offered to new tenants* and the commission policy
 * read at draft time. It deliberately does not touch:
 *   - `subscriptions.current_monthly_cents` — existing tenants keep the price
 *     they were sold, including negotiated discounts.
 *   - any invoice or invoice line — issued documents are immutable, and drafts
 *     store their own amounts until rebuilt.
 * So editing a plan can never retroactively re-price history.
 */
export async function updatePlan(
  input: PlanUpdate,
  actor: string,
): Promise<void> {
  if (!input.name.trim()) throw new Error("Plan name is required");
  if (!Number.isInteger(input.monthlyCents) || input.monthlyCents < 0) {
    throw new Error("Base monthly must be a positive amount");
  }
  if (
    !Number.isFinite(input.commissionRate) ||
    input.commissionRate < 0 ||
    input.commissionRate > 1
  ) {
    throw new Error("Commission rate must be between 0% and 100%");
  }
  if (
    input.graduationThresholdCents !== null &&
    (!Number.isInteger(input.graduationThresholdCents) ||
      input.graduationThresholdCents < 0)
  ) {
    throw new Error("Graduation threshold must be a positive amount");
  }

  await withTransaction(async (conn) => {
    type Before = RowDataPacket & {
      name: string;
      monthly_cents: number;
      commission_rate: string;
      graduation_threshold_cents: number | null;
      graduate_to_code: string | null;
      eligibility: string | null;
      active: number;
    };
    const [rows] = await conn.execute<Before[]>(
      `SELECT name, monthly_cents, commission_rate, graduation_threshold_cents,
              graduate_to_code, eligibility, active
       FROM plans WHERE code = ? LIMIT 1`,
      [input.code],
    );
    const before = rows[0];
    if (!before) throw new Error(`Unknown plan ${input.code}`);

    if (input.graduateToCode) {
      const [target] = await conn.execute<(RowDataPacket & { code: string })[]>(
        `SELECT code FROM plans WHERE code = ? LIMIT 1`,
        [input.graduateToCode],
      );
      if (!target[0]) {
        throw new Error(`Unknown graduation target ${input.graduateToCode}`);
      }
    }

    await conn.execute(
      `UPDATE plans
       SET name = ?, monthly_cents = ?, commission_rate = ?,
           graduation_threshold_cents = ?, graduate_to_code = ?,
           eligibility = ?, active = ?
       WHERE code = ?`,
      [
        input.name.trim(),
        input.monthlyCents,
        input.commissionRate.toFixed(4),
        input.graduationThresholdCents,
        input.graduateToCode,
        input.eligibility?.trim() || null,
        input.active ? 1 : 0,
        input.code,
      ],
    );

    await writeAuditLog(conn, {
      actor,
      action: "plan.updated",
      entityType: "plan",
      entityId: input.code,
      before: {
        name: before.name,
        monthly_cents: Number(before.monthly_cents),
        commission_rate: Number(before.commission_rate),
        graduation_threshold_cents:
          before.graduation_threshold_cents === null
            ? null
            : Number(before.graduation_threshold_cents),
        graduate_to_code: before.graduate_to_code,
        eligibility: before.eligibility,
        active: Boolean(before.active),
      },
      after: {
        name: input.name.trim(),
        monthly_cents: input.monthlyCents,
        commission_rate: input.commissionRate,
        graduation_threshold_cents: input.graduationThresholdCents,
        graduate_to_code: input.graduateToCode,
        eligibility: input.eligibility?.trim() || null,
        active: input.active,
      },
    });
  });
}
