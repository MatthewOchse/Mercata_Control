import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { isVatRegistered } from "@/lib/env";
import {
  assertDraftMutable,
  computeInvoiceTotals,
  type InvoiceStatus,
} from "@/lib/invoices/invariants";
import { periodLabel } from "@/lib/invoices/period";
import { lineTotalCents, sumCents } from "@/lib/money";
import { withTransaction, type PoolConnection } from "@/lib/db/pool";
import { writeAuditLog } from "@/lib/db/audit";

export type DraftLine = {
  description: string;
  quantity: number;
  unitCents: number;
  lineTotalCents: number;
  addonId?: number;
};

export type GenerateResult = {
  invoiceId: number;
  tenantId: number;
  periodStart: string;
  periodEnd: string;
  subtotalCents: number;
  vatCents: number;
  totalCents: number;
  lines: DraftLine[];
};

async function loadActiveSubscription(
  conn: PoolConnection,
  tenantId: number,
  periodStart: string,
  periodEnd: string,
): Promise<{
  plan_code: string;
  plan_name: string;
  current_monthly_cents: number;
} | null> {
  const [rows] = await conn.execute<
    (RowDataPacket & {
      plan_code: string;
      plan_name: string;
      current_monthly_cents: number;
    })[]
  >(
    `SELECT s.plan_code, p.name AS plan_name, s.current_monthly_cents
     FROM subscriptions s
     INNER JOIN plans p ON p.code = s.plan_code
     WHERE s.tenant_id = ?
       AND s.status = 'active'
       AND s.started_on <= ?
       AND (s.ends_on IS NULL OR s.ends_on >= ?)
     ORDER BY s.started_on DESC, s.id DESC
     LIMIT 1`,
    [tenantId, periodEnd, periodStart],
  );
  return rows[0]
    ? {
        plan_code: rows[0].plan_code,
        plan_name: rows[0].plan_name,
        current_monthly_cents: Number(rows[0].current_monthly_cents),
      }
    : null;
}

/**
 * Build a draft invoice for a tenant + period.
 * Lines: subscription snapshot, active recurring addons, unbilled once-offs.
 * Once-offs are marked billed against this draft (cleared if draft is deleted).
 */
export async function generateInvoiceForTenant(
  tenantId: number,
  periodStart: string,
  periodEnd: string,
  actor: string,
): Promise<GenerateResult> {
  return withTransaction(async (conn) => {
    const [tenants] = await conn.execute<(RowDataPacket & { status: string })[]>(
      `SELECT id, status FROM tenants WHERE id = ? LIMIT 1`,
      [tenantId],
    );
    const tenant = tenants[0];
    if (!tenant) throw new Error(`Tenant ${tenantId} not found`);
    if (tenant.status !== "active" && tenant.status !== "suspended") {
      throw new Error(
        `Cannot invoice tenant in status ${tenant.status} (billing continues when suspended)`,
      );
    }

    const [existing] = await conn.execute<(RowDataPacket & { id: number })[]>(
      `SELECT id FROM invoices
       WHERE tenant_id = ? AND period_start = ? AND period_end = ?
         AND status IN ('draft', 'issued', 'paid', 'overdue')
       LIMIT 1`,
      [tenantId, periodStart, periodEnd],
    );
    if (existing[0]) {
      throw new Error(
        `Invoice already exists for this period (id=${existing[0].id})`,
      );
    }

    const sub = await loadActiveSubscription(
      conn,
      tenantId,
      periodStart,
      periodEnd,
    );
    if (!sub) {
      throw new Error("No active subscription covering this period");
    }

    const label = periodLabel(periodStart);
    const lines: DraftLine[] = [];

    lines.push({
      description: `Mercata ${sub.plan_name} — hosting and support, ${label}`,
      quantity: 1,
      unitCents: sub.current_monthly_cents,
      lineTotalCents: lineTotalCents(1, sub.current_monthly_cents),
    });

    const [recurring] = await conn.execute<
      (RowDataPacket & {
        id: number;
        description: string;
        amount_cents: number;
      })[]
    >(
      `SELECT id, description, amount_cents FROM addons
       WHERE tenant_id = ?
         AND kind = 'recurring'
         AND active_from <= ?
         AND (active_until IS NULL OR active_until >= ?)
       ORDER BY id`,
      [tenantId, periodEnd, periodStart],
    );
    for (const a of recurring) {
      const unit = Number(a.amount_cents);
      lines.push({
        description: a.description,
        quantity: 1,
        unitCents: unit,
        lineTotalCents: lineTotalCents(1, unit),
        addonId: Number(a.id),
      });
    }

    const [onceOffs] = await conn.execute<
      (RowDataPacket & {
        id: number;
        description: string;
        amount_cents: number;
      })[]
    >(
      `SELECT id, description, amount_cents FROM addons
       WHERE tenant_id = ?
         AND kind = 'once_off'
         AND billed_invoice_id IS NULL
         AND active_from <= ?
         AND (active_until IS NULL OR active_until >= ?)
       ORDER BY id`,
      [tenantId, periodEnd, periodStart],
    );
    const onceOffIds: number[] = [];
    for (const a of onceOffs) {
      const unit = Number(a.amount_cents);
      lines.push({
        description: a.description,
        quantity: 1,
        unitCents: unit,
        lineTotalCents: lineTotalCents(1, unit),
        addonId: Number(a.id),
      });
      onceOffIds.push(Number(a.id));
    }

    if (lines.length === 0) {
      throw new Error("No billable lines for this period");
    }

    const totals = computeInvoiceTotals(
      lines.map((l) => l.lineTotalCents),
      isVatRegistered(),
    );

    const [invResult] = await conn.execute<ResultSetHeader>(
      `INSERT INTO invoices
         (tenant_id, invoice_number, status, period_start, period_end,
          subtotal_cents, vat_cents, total_cents)
       VALUES (?, NULL, 'draft', ?, ?, ?, ?, ?)`,
      [
        tenantId,
        periodStart,
        periodEnd,
        totals.subtotalCents,
        totals.vatCents,
        totals.totalCents,
      ],
    );
    const invoiceId = Number(invResult.insertId);

    let sort = 0;
    for (const line of lines) {
      await conn.execute(
        `INSERT INTO invoice_lines
           (invoice_id, description, quantity, unit_cents, line_total_cents, sort_order)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          invoiceId,
          line.description,
          line.quantity,
          line.unitCents,
          line.lineTotalCents,
          sort++,
        ],
      );
    }

    if (onceOffIds.length > 0) {
      await conn.execute(
        `UPDATE addons SET billed_invoice_id = ?
         WHERE id IN (${onceOffIds.map(() => "?").join(",")})`,
        [invoiceId, ...onceOffIds],
      );
    }

    await writeAuditLog(conn, {
      actor,
      action: "invoice.generate_draft",
      entityType: "invoice",
      entityId: invoiceId,
      after: {
        tenant_id: tenantId,
        period_start: periodStart,
        period_end: periodEnd,
        total_cents: totals.totalCents,
        line_count: lines.length,
      },
    });

    return {
      invoiceId,
      tenantId,
      periodStart,
      periodEnd,
      subtotalCents: totals.subtotalCents,
      vatCents: totals.vatCents,
      totalCents: totals.totalCents,
      lines,
    };
  });
}

/** Data-access: delete draft only. Issued/paid/void have no delete path. */
export async function deleteDraftInvoice(
  invoiceId: number,
  actor: string,
): Promise<void> {
  await withTransaction(async (conn) => {
    const inv = await lockInvoice(conn, invoiceId);
    assertDraftMutable(inv.status);

    await conn.execute(
      `UPDATE addons SET billed_invoice_id = NULL WHERE billed_invoice_id = ?`,
      [invoiceId],
    );
    await conn.execute(`DELETE FROM invoice_lines WHERE invoice_id = ?`, [
      invoiceId,
    ]);
    await conn.execute(`DELETE FROM invoices WHERE id = ?`, [invoiceId]);

    await writeAuditLog(conn, {
      actor,
      action: "invoice.delete_draft",
      entityType: "invoice",
      entityId: invoiceId,
      before: {
        status: inv.status,
        period_start: inv.period_start,
        period_end: inv.period_end,
      },
    });
  });
}

export type LockedInvoice = {
  id: number;
  tenant_id: number;
  invoice_number: string | null;
  status: InvoiceStatus;
  issue_date: string | null;
  due_date: string | null;
  period_start: string;
  period_end: string;
  subtotal_cents: number;
  vat_cents: number;
  total_cents: number;
  pdf_path: string | null;
};

export async function lockInvoice(
  conn: PoolConnection,
  invoiceId: number,
): Promise<LockedInvoice> {
  const [rows] = await conn.execute<(RowDataPacket & LockedInvoice)[]>(
    `SELECT id, tenant_id, invoice_number, status, issue_date, due_date,
            period_start, period_end, subtotal_cents, vat_cents, total_cents, pdf_path
     FROM invoices WHERE id = ? FOR UPDATE`,
    [invoiceId],
  );
  const row = rows[0];
  if (!row) throw new Error(`Invoice ${invoiceId} not found`);
  return {
    id: Number(row.id),
    tenant_id: Number(row.tenant_id),
    invoice_number: row.invoice_number,
    status: row.status,
    issue_date: row.issue_date ? String(row.issue_date).slice(0, 10) : null,
    due_date: row.due_date ? String(row.due_date).slice(0, 10) : null,
    period_start: String(row.period_start).slice(0, 10),
    period_end: String(row.period_end).slice(0, 10),
    subtotal_cents: Number(row.subtotal_cents),
    vat_cents: Number(row.vat_cents),
    total_cents: Number(row.total_cents),
    pdf_path: row.pdf_path,
  };
}

/** Forbidden: any content mutation on immutable invoices. */
export async function assertInvoiceContentMutable(
  conn: PoolConnection,
  invoiceId: number,
): Promise<void> {
  const inv = await lockInvoice(conn, invoiceId);
  assertDraftMutable(inv.status);
}

export function sumLineTotals(lines: { lineTotalCents: number }[]): number {
  return sumCents(lines.map((l) => l.lineTotalCents));
}
