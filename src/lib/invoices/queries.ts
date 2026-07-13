import type { RowDataPacket } from "mysql2/promise";
import { query } from "@/lib/db/pool";
import type { InvoiceStatus } from "@/lib/invoices/invariants";

export type InvoiceListRow = {
  id: number;
  invoice_number: string | null;
  status: InvoiceStatus;
  trading_name: string;
  slug: string;
  issue_date: string | null;
  due_date: string | null;
  period_start: string;
  period_end: string;
  total_cents: number;
  sent_at: string | null;
  unsent: boolean;
};

export async function listInvoices(): Promise<InvoiceListRow[]> {
  const rows = await query<(InvoiceListRow & RowDataPacket & { sent_at: string | null })[]>(
    `SELECT i.id, i.invoice_number, i.status, t.trading_name, t.slug,
            i.issue_date, i.due_date, i.period_start, i.period_end, i.total_cents,
            i.sent_at
     FROM invoices i
     INNER JOIN tenants t ON t.id = i.tenant_id
     ORDER BY COALESCE(i.issue_date, i.created_at) DESC, i.id DESC`,
  );
  return rows.map((r) => ({
    id: Number(r.id),
    invoice_number: r.invoice_number,
    status: r.status,
    trading_name: r.trading_name,
    slug: r.slug,
    issue_date: r.issue_date ? String(r.issue_date).slice(0, 10) : null,
    due_date: r.due_date ? String(r.due_date).slice(0, 10) : null,
    period_start: String(r.period_start).slice(0, 10),
    period_end: String(r.period_end).slice(0, 10),
    total_cents: Number(r.total_cents),
    sent_at: r.sent_at ? String(r.sent_at) : null,
    unsent:
      (r.status === "issued" || r.status === "overdue") &&
      !r.sent_at &&
      Boolean(r.invoice_number),
  }));
}

export type InvoiceDetail = InvoiceListRow & {
  tenant_id: number;
  subtotal_cents: number;
  vat_cents: number;
  pdf_path: string | null;
  issued_at: string | null;
  paid_cents: number;
  outstanding_cents: number;
  lines: {
    id: number;
    description: string;
    quantity: number;
    unit_cents: number;
    line_total_cents: number;
  }[];
  credit_notes: {
    id: number;
    credit_note_number: string;
    reason: string;
    total_cents: number;
    issued_at: string;
  }[];
  payments: {
    id: number;
    amount_cents: number;
    method: string;
    reference: string | null;
    received_on: string;
    captured_by: string;
  }[];
};

export async function getInvoiceById(
  id: number,
): Promise<InvoiceDetail | null> {
  const rows = await query<
    (RowDataPacket & {
      id: number;
      tenant_id: number;
      invoice_number: string | null;
      status: InvoiceStatus;
      trading_name: string;
      slug: string;
      issue_date: string | null;
      due_date: string | null;
      period_start: string;
      period_end: string;
      subtotal_cents: number;
      vat_cents: number;
      total_cents: number;
      pdf_path: string | null;
      issued_at: string | null;
      sent_at: string | null;
    })[]
  >(
    `SELECT i.id, i.tenant_id, i.invoice_number, i.status, t.trading_name, t.slug,
            i.issue_date, i.due_date, i.period_start, i.period_end,
            i.subtotal_cents, i.vat_cents, i.total_cents, i.pdf_path, i.issued_at,
            i.sent_at
     FROM invoices i
     INNER JOIN tenants t ON t.id = i.tenant_id
     WHERE i.id = :id LIMIT 1`,
    { id },
  );
  const row = rows[0];
  if (!row) return null;

  const lines = await query<
    (RowDataPacket & {
      id: number;
      description: string;
      quantity: number;
      unit_cents: number;
      line_total_cents: number;
    })[]
  >(
    `SELECT id, description, quantity, unit_cents, line_total_cents
     FROM invoice_lines WHERE invoice_id = :id ORDER BY sort_order, id`,
    { id },
  );

  const creditNotes = await query<
    (RowDataPacket & {
      id: number;
      credit_note_number: string;
      reason: string;
      total_cents: number;
      issued_at: string;
    })[]
  >(
    `SELECT id, credit_note_number, reason, total_cents, issued_at
     FROM credit_notes WHERE invoice_id = :id ORDER BY id`,
    { id },
  );

  const payments = await query<
    (RowDataPacket & {
      id: number;
      amount_cents: number;
      method: string;
      reference: string | null;
      received_on: string;
      captured_by: string;
    })[]
  >(
    `SELECT id, amount_cents, method, reference, received_on, captured_by
     FROM payments WHERE invoice_id = :id ORDER BY received_on, id`,
    { id },
  );

  const paidCents = payments.reduce((s, p) => s + Number(p.amount_cents), 0);
  const total = Number(row.total_cents);

  return {
    id: Number(row.id),
    tenant_id: Number(row.tenant_id),
    invoice_number: row.invoice_number,
    status: row.status,
    trading_name: row.trading_name,
    slug: row.slug,
    issue_date: row.issue_date ? String(row.issue_date).slice(0, 10) : null,
    due_date: row.due_date ? String(row.due_date).slice(0, 10) : null,
    period_start: String(row.period_start).slice(0, 10),
    period_end: String(row.period_end).slice(0, 10),
    subtotal_cents: Number(row.subtotal_cents),
    vat_cents: Number(row.vat_cents),
    total_cents: total,
    pdf_path: row.pdf_path,
    issued_at: row.issued_at ? String(row.issued_at) : null,
    sent_at: row.sent_at ? String(row.sent_at) : null,
    unsent:
      (row.status === "issued" || row.status === "overdue") &&
      !row.sent_at &&
      Boolean(row.invoice_number),
    paid_cents: paidCents,
    outstanding_cents: Math.max(0, total - paidCents),
    lines: lines.map((l) => ({
      id: Number(l.id),
      description: l.description,
      quantity: Number(l.quantity),
      unit_cents: Number(l.unit_cents),
      line_total_cents: Number(l.line_total_cents),
    })),
    credit_notes: creditNotes.map((c) => ({
      id: Number(c.id),
      credit_note_number: c.credit_note_number,
      reason: c.reason,
      total_cents: Number(c.total_cents),
      issued_at: String(c.issued_at),
    })),
    payments: payments.map((p) => ({
      id: Number(p.id),
      amount_cents: Number(p.amount_cents),
      method: p.method,
      reference: p.reference,
      received_on: String(p.received_on).slice(0, 10),
      captured_by: p.captured_by,
    })),
  };
}

export type BillingPreviewRow = {
  tenantId: number;
  slug: string;
  tradingName: string;
  status: string;
  planName: string | null;
  estimatedCents: number;
  existingInvoiceId: number | null;
  existingStatus: string | null;
};

export async function previewBillingRun(
  periodStart: string,
  periodEnd: string,
): Promise<BillingPreviewRow[]> {
  const tenants = await query<
    (RowDataPacket & {
      id: number;
      slug: string;
      trading_name: string;
      status: string;
      plan_name: string | null;
      plan_mrr: number | null;
      addon_mrr: number | null;
      once_off: number | null;
      existing_id: number | null;
      existing_status: string | null;
    })[]
  >(
    `SELECT
       t.id, t.slug, t.trading_name, t.status,
       p.name AS plan_name,
       s.current_monthly_cents AS plan_mrr,
       (
         SELECT COALESCE(SUM(a.amount_cents), 0) FROM addons a
         WHERE a.tenant_id = t.id AND a.kind = 'recurring'
           AND a.active_from <= :periodEnd
           AND (a.active_until IS NULL OR a.active_until >= :periodStart)
       ) AS addon_mrr,
       (
         SELECT COALESCE(SUM(a.amount_cents), 0) FROM addons a
         WHERE a.tenant_id = t.id AND a.kind = 'once_off'
           AND a.billed_invoice_id IS NULL
           AND a.active_from <= :periodEnd
           AND (a.active_until IS NULL OR a.active_until >= :periodStart)
       ) AS once_off,
       (
         SELECT i.id FROM invoices i
         WHERE i.tenant_id = t.id AND i.period_start = :periodStart AND i.period_end = :periodEnd
           AND i.status IN ('draft','issued','paid','overdue')
         LIMIT 1
       ) AS existing_id,
       (
         SELECT i.status FROM invoices i
         WHERE i.tenant_id = t.id AND i.period_start = :periodStart AND i.period_end = :periodEnd
           AND i.status IN ('draft','issued','paid','overdue')
         LIMIT 1
       ) AS existing_status
     FROM tenants t
     LEFT JOIN subscriptions s ON s.id = (
       SELECT s2.id FROM subscriptions s2
       WHERE s2.tenant_id = t.id AND s2.status = 'active'
         AND s2.started_on <= :periodEnd
         AND (s2.ends_on IS NULL OR s2.ends_on >= :periodStart)
       ORDER BY s2.started_on DESC, s2.id DESC LIMIT 1
     )
     LEFT JOIN plans p ON p.code = s.plan_code
     WHERE t.status IN ('active', 'suspended')
     ORDER BY t.trading_name`,
    { periodStart, periodEnd },
  );

  return tenants.map((t) => ({
    tenantId: Number(t.id),
    slug: t.slug,
    tradingName: t.trading_name,
    status: t.status,
    planName: t.plan_name,
    estimatedCents:
      Number(t.plan_mrr ?? 0) +
      Number(t.addon_mrr ?? 0) +
      Number(t.once_off ?? 0),
    existingInvoiceId: t.existing_id === null ? null : Number(t.existing_id),
    existingStatus: t.existing_status,
  }));
}
