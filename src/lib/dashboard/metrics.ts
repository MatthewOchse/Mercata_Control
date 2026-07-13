import type { RowDataPacket } from "mysql2/promise";
import { sastToday } from "@/lib/billing/cycle";
import { query } from "@/lib/db/pool";

export type DashboardMetrics = {
  mrrCents: number;
  outstandingCents: number;
  overdueCount: number;
  draftsAwaitingIssue: number;
  unsentCount: number;
};

export type UnsentInvoice = {
  id: number;
  invoice_number: string;
  trading_name: string;
  slug: string;
  total_cents: number;
  issue_date: string | null;
};

export type OperatorTaskRow = {
  id: number;
  kind: string;
  tenant_id: number | null;
  invoice_id: number | null;
  title: string;
  body: string | null;
  slug: string | null;
  trading_name: string | null;
  created_at: string;
};

export async function getDashboardMetrics(): Promise<DashboardMetrics> {
  const today = sastToday();

  const mrr = await query<(RowDataPacket & { total: number })[]>(
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

  const outstanding = await query<(RowDataPacket & { total: number })[]>(
    `SELECT COALESCE(SUM(
       i.total_cents - COALESCE((
         SELECT SUM(p.amount_cents) FROM payments p WHERE p.invoice_id = i.id
       ), 0)
     ), 0) AS total
     FROM invoices i
     WHERE i.status IN ('issued', 'overdue')`,
  );

  const overdue = await query<(RowDataPacket & { c: number })[]>(
    `SELECT COUNT(*) AS c FROM invoices WHERE status = 'overdue'`,
  );

  const drafts = await query<(RowDataPacket & { c: number })[]>(
    `SELECT COUNT(*) AS c FROM invoices WHERE status = 'draft'`,
  );

  const unsent = await query<(RowDataPacket & { c: number })[]>(
    `SELECT COUNT(*) AS c FROM invoices
     WHERE status IN ('issued', 'overdue')
       AND pdf_path IS NOT NULL
       AND sent_at IS NULL`,
  );

  return {
    mrrCents: Number(mrr[0]?.total ?? 0),
    outstandingCents: Math.max(0, Number(outstanding[0]?.total ?? 0)),
    overdueCount: Number(overdue[0]?.c ?? 0),
    draftsAwaitingIssue: Number(drafts[0]?.c ?? 0),
    unsentCount: Number(unsent[0]?.c ?? 0),
  };
}

export async function listUnsentInvoices(): Promise<UnsentInvoice[]> {
  const rows = await query<(UnsentInvoice & RowDataPacket)[]>(
    `SELECT i.id, i.invoice_number, t.trading_name, t.slug, i.total_cents, i.issue_date
     FROM invoices i
     INNER JOIN tenants t ON t.id = i.tenant_id
     WHERE i.status IN ('issued', 'overdue')
       AND i.pdf_path IS NOT NULL
       AND i.sent_at IS NULL
       AND i.invoice_number IS NOT NULL
     ORDER BY i.issue_date ASC, i.id ASC`,
  );
  return rows.map((r) => ({
    id: Number(r.id),
    invoice_number: r.invoice_number,
    trading_name: r.trading_name,
    slug: r.slug,
    total_cents: Number(r.total_cents),
    issue_date: r.issue_date ? String(r.issue_date).slice(0, 10) : null,
  }));
}

export async function listOpenOperatorTasks(): Promise<OperatorTaskRow[]> {
  const rows = await query<(OperatorTaskRow & RowDataPacket)[]>(
    `SELECT ot.id, ot.kind, ot.tenant_id, ot.invoice_id, ot.title, ot.body,
            ot.created_at, t.slug, t.trading_name
     FROM operator_tasks ot
     LEFT JOIN tenants t ON t.id = ot.tenant_id
     WHERE ot.status = 'open'
     ORDER BY ot.created_at ASC`,
  );
  return rows.map((r) => ({
    id: Number(r.id),
    kind: r.kind,
    tenant_id: r.tenant_id === null ? null : Number(r.tenant_id),
    invoice_id: r.invoice_id === null ? null : Number(r.invoice_id),
    title: r.title,
    body: r.body,
    slug: r.slug,
    trading_name: r.trading_name,
    created_at: String(r.created_at),
  }));
}
