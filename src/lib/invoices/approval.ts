/**
 * Draft review gate: DRAFT → APPROVED → issued.
 *
 * "Approved" is a draft with `approved_at` set rather than a new status value,
 * which keeps the existing status enum and immutability invariants intact.
 * Only approved drafts can be issued (enforced in `issueInvoice`).
 */

import type { RowDataPacket } from "mysql2/promise";
import { writeAuditLog } from "@/lib/db/audit";
import { execute, query, withTransaction } from "@/lib/db/pool";
import { lockInvoice, rebuildDraftInvoice } from "@/lib/invoices/generate";
import {
  previousSastMonth,
  sastMonthFromIso,
  sastMonthWindow,
} from "@/lib/sales/period";

export async function approveDraft(
  invoiceId: number,
  actor: string,
): Promise<void> {
  await withTransaction(async (conn) => {
    const inv = await lockInvoice(conn, invoiceId);
    if (inv.status !== "draft") {
      throw new Error(`Only drafts can be approved (invoice is ${inv.status})`);
    }
    if (inv.needs_attention) {
      throw new Error(
        `Resolve the flagged problem first: ${inv.attention_reason ?? "unknown"}`,
      );
    }
    if (inv.approved_at) return;

    await conn.execute(
      `UPDATE invoices
       SET approved_at = UTC_TIMESTAMP(3), approved_by = ?
       WHERE id = ? AND status = 'draft'`,
      [actor, invoiceId],
    );
    await writeAuditLog(conn, {
      actor,
      action: "invoice.approved",
      entityType: "invoice",
      entityId: invoiceId,
      after: { total_cents: inv.total_cents, approved_by: actor },
    });
  });
}

export async function unapproveDraft(
  invoiceId: number,
  actor: string,
): Promise<void> {
  await withTransaction(async (conn) => {
    const inv = await lockInvoice(conn, invoiceId);
    if (inv.status !== "draft") {
      throw new Error(`Only drafts can be unapproved (invoice is ${inv.status})`);
    }
    await conn.execute(
      `UPDATE invoices SET approved_at = NULL, approved_by = NULL WHERE id = ?`,
      [invoiceId],
    );
    await writeAuditLog(conn, {
      actor,
      action: "invoice.approval_withdrawn",
      entityType: "invoice",
      entityId: invoiceId,
      before: { approved_at: inv.approved_at },
    });
  });
}

/** Approve every clean draft for a period. Flagged drafts are skipped, not forced. */
export async function approveDraftsForPeriod(
  periodStart: string,
  periodEnd: string,
  actor: string,
): Promise<{ approved: number; skipped: number; errors: string[] }> {
  const rows = await query<
    (RowDataPacket & {
      id: number;
      needs_attention: number;
      slug: string;
    })[]
  >(
    `SELECT i.id, i.needs_attention, t.slug
     FROM invoices i
     INNER JOIN tenants t ON t.id = i.tenant_id
     WHERE i.status = 'draft'
       AND i.period_start = :periodStart
       AND i.period_end = :periodEnd
       AND i.approved_at IS NULL
     ORDER BY t.trading_name`,
    { periodStart, periodEnd },
  );

  let approved = 0;
  let skipped = 0;
  const errors: string[] = [];
  for (const row of rows) {
    if (Number(row.needs_attention) === 1) {
      skipped++;
      continue;
    }
    try {
      await approveDraft(Number(row.id), actor);
      approved++;
    } catch (err) {
      errors.push(`${row.slug}: ${err instanceof Error ? err.message : "failed"}`);
    }
  }
  return { approved, skipped, errors };
}

/**
 * Record a sales figure read by hand (from the tenant's own dashboard, say)
 * when the automated read failed, then rebuild the draft so the commission
 * line is calculated from it. The figure is stored with source 'manual' so it
 * is always distinguishable from a measured one.
 */
export async function setManualSalesFigure(opts: {
  invoiceId: number;
  grossCents: number;
  actor: string;
}): Promise<void> {
  if (!Number.isInteger(opts.grossCents) || opts.grossCents < 0) {
    throw new Error("Gross sales must be a positive amount");
  }

  const rows = await query<
    (RowDataPacket & {
      tenant_id: number;
      status: string;
      period_start: string;
    })[]
  >(
    `SELECT tenant_id, status, period_start FROM invoices WHERE id = :id LIMIT 1`,
    { id: opts.invoiceId },
  );
  const inv = rows[0];
  if (!inv) throw new Error("Invoice not found");
  if (inv.status !== "draft") {
    throw new Error("Only drafts can have their sales figure corrected");
  }

  const tenantId = Number(inv.tenant_id);
  const salesMonth = previousSastMonth(
    sastMonthFromIso(String(inv.period_start).slice(0, 10)),
  );
  const window = sastMonthWindow(salesMonth.year, salesMonth.month);

  await execute(
    `INSERT INTO tenant_sales_monthly
       (tenant_id, period_year, period_month, period_start, period_end,
        gross_cents, order_count, currency, source, ok, error)
     VALUES
       (:tenantId, :year, :month, :periodStart, :periodEnd,
        :grossCents, NULL, 'ZAR', 'manual', 1, NULL)
     ON DUPLICATE KEY UPDATE
       gross_cents = VALUES(gross_cents),
       order_count = NULL,
       source = 'manual',
       ok = 1,
       error = NULL`,
    {
      tenantId,
      year: salesMonth.year,
      month: salesMonth.month,
      periodStart: window.periodStart,
      periodEnd: window.periodEnd,
      grossCents: opts.grossCents,
    },
  );

  await withTransaction(async (conn) => {
    await writeAuditLog(conn, {
      actor: opts.actor,
      action: "sales.manual_override",
      entityType: "tenant",
      entityId: tenantId,
      after: {
        period: `${window.year}-${window.month}`,
        gross_cents: opts.grossCents,
        source: "manual",
        invoice_id: opts.invoiceId,
      },
    });
  });

  // A manual figure outranks every machine source, so rebuilding now adds the
  // commission line and clears the flag on its own.
  await rebuildDraftInvoice(opts.invoiceId, opts.actor);
}

/**
 * Bill the base fee only and drop the commission for this period, on the
 * record. Used when a sales figure genuinely cannot be established in time.
 */
export async function waiveCommissionForDraft(opts: {
  invoiceId: number;
  reason: string;
  actor: string;
}): Promise<void> {
  const reason = opts.reason.trim();
  if (!reason) throw new Error("A reason is required to waive commission");

  await withTransaction(async (conn) => {
    const inv = await lockInvoice(conn, opts.invoiceId);
    if (inv.status !== "draft") {
      throw new Error("Only drafts can have commission waived");
    }
    await conn.execute(
      `UPDATE invoices
       SET needs_attention = 0,
           attention_reason = ?,
           commission_basis_cents = NULL,
           commission_cents = NULL
       WHERE id = ?`,
      [`Commission waived: ${reason}`, opts.invoiceId],
    );
    await writeAuditLog(conn, {
      actor: opts.actor,
      action: "invoice.commission_waived",
      entityType: "invoice",
      entityId: opts.invoiceId,
      before: { attention_reason: inv.attention_reason },
      after: { reason, total_cents: inv.total_cents },
    });
  });
}
