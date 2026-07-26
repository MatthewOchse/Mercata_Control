import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { isVatRegistered } from "@/lib/env";
import {
  assertDraftMutable,
  computeInvoiceTotals,
  type InvoiceStatus,
} from "@/lib/invoices/invariants";
import { periodLabel } from "@/lib/invoices/period";
import { formatZAR, lineTotalCents, sumCents } from "@/lib/money";
import { commissionCents, getTenantGrossSales } from "@/lib/sales/gross-sales";
import {
  isMonthClosed,
  previousSastMonth,
  sastMonthFromIso,
  sastMonthWindow,
} from "@/lib/sales/period";
import { query } from "@/lib/db/pool";
import { withTransaction, type PoolConnection } from "@/lib/db/pool";
import { writeAuditLog } from "@/lib/db/audit";

export type DraftLine = {
  description: string;
  quantity: number;
  unitCents: number;
  lineTotalCents: number;
  addonId?: number;
};

/**
 * Commission resolved for one draft. `needsAttention` means the sales figure
 * could not be read: the draft is created without a commission line and is
 * blocked from approval until an operator deals with it. Never a silent zero.
 */
export type CommissionOutcome = {
  rate: number;
  basisCents: number | null;
  commissionCents: number | null;
  salesPeriodStart: string;
  salesPeriodEnd: string;
  salesLabel: string;
  source: string | null;
  needsAttention: boolean;
  attentionReason: string | null;
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
  commission?: CommissionOutcome | null;
};

const SUBSCRIPTION_SELECT = `
  SELECT s.plan_code, p.name AS plan_name, s.current_monthly_cents,
         p.commission_rate
  FROM subscriptions s
  INNER JOIN plans p ON p.code = s.plan_code
  WHERE s.tenant_id = ?
    AND s.status = 'active'
    AND s.started_on <= ?
    AND (s.ends_on IS NULL OR s.ends_on >= ?)
  ORDER BY s.started_on DESC, s.id DESC
  LIMIT 1`;

type SubscriptionForBilling = {
  plan_code: string;
  plan_name: string;
  current_monthly_cents: number;
  commission_rate: number;
};

type SubscriptionRow = RowDataPacket & {
  plan_code: string;
  plan_name: string;
  current_monthly_cents: number;
  commission_rate: string | number;
};

function mapSubscription(row: SubscriptionRow): SubscriptionForBilling {
  return {
    plan_code: row.plan_code,
    plan_name: row.plan_name,
    current_monthly_cents: Number(row.current_monthly_cents),
    commission_rate: Number(row.commission_rate),
  };
}

async function loadActiveSubscription(
  conn: PoolConnection,
  tenantId: number,
  periodStart: string,
  periodEnd: string,
): Promise<SubscriptionForBilling | null> {
  const [rows] = await conn.execute<SubscriptionRow[]>(SUBSCRIPTION_SELECT, [
    tenantId,
    periodEnd,
    periodStart,
  ]);
  return rows[0] ? mapSubscription(rows[0]) : null;
}

/**
 * Resolve the commission for a billing period, outside any transaction.
 *
 * Billing runs in advance, so the period being invoiced is the month ahead and
 * the month being commissioned is the one that just closed — the month before
 * `periodStart`. Reading sales involves an HTTP call to the tenant's own
 * deployment, which is why this is deliberately kept out of the invoice
 * transaction rather than folded into line building.
 *
 * Returns null for flat plans (no commission at all).
 */
export async function resolveCommissionForPeriod(
  tenantId: number,
  periodStart: string,
  periodEnd: string,
): Promise<CommissionOutcome | null> {
  const subRows = await query<SubscriptionRow[]>(
    `SELECT s.plan_code, p.name AS plan_name, s.current_monthly_cents,
            p.commission_rate
     FROM subscriptions s
     INNER JOIN plans p ON p.code = s.plan_code
     WHERE s.tenant_id = :tenantId
       AND s.status = 'active'
       AND s.started_on <= :periodEnd
       AND (s.ends_on IS NULL OR s.ends_on >= :periodStart)
     ORDER BY s.started_on DESC, s.id DESC
     LIMIT 1`,
    { tenantId, periodEnd, periodStart },
  );
  const sub = subRows[0] ? mapSubscription(subRows[0]) : null;
  if (!sub || sub.commission_rate <= 0) return null;

  const salesMonth = previousSastMonth(sastMonthFromIso(periodStart));
  const window = sastMonthWindow(salesMonth.year, salesMonth.month);
  const shared = {
    rate: sub.commission_rate,
    salesPeriodStart: window.periodStart,
    salesPeriodEnd: window.periodEnd,
    salesLabel: window.label,
  };

  if (!isMonthClosed(salesMonth)) {
    return {
      ...shared,
      basisCents: null,
      commissionCents: null,
      source: null,
      needsAttention: true,
      attentionReason: `${window.label} has not ended yet — commission cannot be billed on a partial month`,
    };
  }

  const sales = await getTenantGrossSales(
    tenantId,
    salesMonth.year,
    salesMonth.month,
  );

  if (!sales.ok) {
    return {
      ...shared,
      basisCents: null,
      commissionCents: null,
      source: null,
      needsAttention: true,
      attentionReason: `${window.label} sales figure unavailable: ${sales.error}`,
    };
  }

  return {
    ...shared,
    basisCents: sales.grossSalesCents,
    commissionCents: commissionCents(sales.grossSalesCents, sub.commission_rate),
    source: sales.source,
    needsAttention: false,
    attentionReason: null,
  };
}

function commissionLineDescription(
  outcome: CommissionOutcome,
): string {
  const pct = Number((outcome.rate * 100).toFixed(2));
  return `Commission — ${pct}% of ${outcome.salesLabel} gross sales of ${formatZAR(
    outcome.basisCents ?? 0,
  )} (before refunds)`;
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
  // Reading sales calls the tenant's own deployment — do it before opening the
  // transaction so a slow storefront never holds an invoice write open.
  const commission = await resolveCommissionForPeriod(
    tenantId,
    periodStart,
    periodEnd,
  );

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

    const built = await buildDraftLines(
      conn,
      tenantId,
      periodStart,
      periodEnd,
      commission,
    );
    const { lines, onceOffIds, totals } = built;

    const [invResult] = await conn.execute<ResultSetHeader>(
      `INSERT INTO invoices
         (tenant_id, invoice_number, status, source, period_start, period_end,
          subtotal_cents, vat_cents, total_cents,
          needs_attention, attention_reason,
          commission_rate, commission_basis_cents, commission_cents,
          sales_period_start, sales_period_end, sales_source)
       VALUES (?, NULL, 'draft', 'auto', ?, ?, ?, ?, ?,
               ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        tenantId,
        periodStart,
        periodEnd,
        totals.subtotalCents,
        totals.vatCents,
        totals.totalCents,
        commission?.needsAttention ? 1 : 0,
        commission?.attentionReason ?? null,
        commission ? commission.rate.toFixed(4) : null,
        commission?.basisCents ?? null,
        commission?.commissionCents ?? null,
        commission?.salesPeriodStart ?? null,
        commission?.salesPeriodEnd ?? null,
        commission?.source ?? null,
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
        commission_basis_cents: commission?.basisCents ?? null,
        commission_cents: commission?.commissionCents ?? null,
        sales_source: commission?.source ?? null,
        needs_attention: commission?.needsAttention ?? false,
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

/**
 * Rebuild line items on an existing draft (e.g. after expenses/price change).
 * Issued invoices are never touched.
 */
export async function rebuildDraftInvoice(
  invoiceId: number,
  actor: string,
): Promise<GenerateResult> {
  // Peek at the period first so the sales lookup (an HTTP call to the tenant)
  // happens before the row is locked. The transaction re-reads and validates.
  const peek = await query<
    (RowDataPacket & {
      tenant_id: number;
      period_start: string;
      period_end: string;
    })[]
  >(
    `SELECT tenant_id, period_start, period_end FROM invoices
     WHERE id = :invoiceId LIMIT 1`,
    { invoiceId },
  );
  if (!peek[0]) throw new Error(`Invoice ${invoiceId} not found`);
  const commission = await resolveCommissionForPeriod(
    Number(peek[0].tenant_id),
    String(peek[0].period_start).slice(0, 10),
    String(peek[0].period_end).slice(0, 10),
  );

  return withTransaction(async (conn) => {
    const inv = await lockInvoice(conn, invoiceId);
    assertDraftMutable(inv.status);
    if (inv.source === "manual") {
      throw new Error(
        "Manual (custom) drafts are locked — edit lines on the invoice instead of rebuilding",
      );
    }

    await conn.execute(
      `UPDATE addons SET billed_invoice_id = NULL WHERE billed_invoice_id = ?`,
      [invoiceId],
    );
    await conn.execute(`DELETE FROM invoice_lines WHERE invoice_id = ?`, [
      invoiceId,
    ]);

    const built = await buildDraftLines(
      conn,
      inv.tenant_id,
      inv.period_start,
      inv.period_end,
      commission,
    );

    // Rebuilding re-reads the sales figure, so approval is withdrawn: the
    // operator must review the new numbers before this can be issued.
    await conn.execute(
      `UPDATE invoices
       SET subtotal_cents = ?, vat_cents = ?, total_cents = ?,
           approved_at = NULL, approved_by = NULL,
           needs_attention = ?, attention_reason = ?,
           commission_rate = ?, commission_basis_cents = ?, commission_cents = ?,
           sales_period_start = ?, sales_period_end = ?, sales_source = ?
       WHERE id = ?`,
      [
        built.totals.subtotalCents,
        built.totals.vatCents,
        built.totals.totalCents,
        commission?.needsAttention ? 1 : 0,
        commission?.attentionReason ?? null,
        commission ? commission.rate.toFixed(4) : null,
        commission?.basisCents ?? null,
        commission?.commissionCents ?? null,
        commission?.salesPeriodStart ?? null,
        commission?.salesPeriodEnd ?? null,
        commission?.source ?? null,
        invoiceId,
      ],
    );

    let sort = 0;
    for (const line of built.lines) {
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

    if (built.onceOffIds.length > 0) {
      await conn.execute(
        `UPDATE addons SET billed_invoice_id = ?
         WHERE id IN (${built.onceOffIds.map(() => "?").join(",")})`,
        [invoiceId, ...built.onceOffIds],
      );
    }

    await writeAuditLog(conn, {
      actor,
      action: "invoice.rebuild_draft",
      entityType: "invoice",
      entityId: invoiceId,
      after: {
        tenant_id: inv.tenant_id,
        period_start: inv.period_start,
        period_end: inv.period_end,
        total_cents: built.totals.totalCents,
        line_count: built.lines.length,
        commission_basis_cents: commission?.basisCents ?? null,
        commission_cents: commission?.commissionCents ?? null,
        needs_attention: commission?.needsAttention ?? false,
      },
    });

    return {
      invoiceId,
      tenantId: inv.tenant_id,
      periodStart: inv.period_start,
      periodEnd: inv.period_end,
      subtotalCents: built.totals.subtotalCents,
      vatCents: built.totals.vatCents,
      totalCents: built.totals.totalCents,
      lines: built.lines,
      commission,
    };
  });
}

/** Rebuild every auto draft invoice for a tenant (after expense / price edits). */
export async function rebuildTenantDraftInvoices(
  tenantId: number,
  actor: string,
): Promise<number> {
  const drafts = await withTransaction(async (conn) => {
    const [rows] = await conn.execute<(RowDataPacket & { id: number })[]>(
      `SELECT id FROM invoices
       WHERE tenant_id = ? AND status = 'draft' AND source = 'auto'`,
      [tenantId],
    );
    return rows.map((r) => Number(r.id));
  });

  for (const id of drafts) {
    await rebuildDraftInvoice(id, actor);
  }
  return drafts.length;
}

/** Build package + addon lines for a period (used to seed custom drafts). */
export async function previewSourceLines(
  tenantId: number,
  periodStart: string,
  periodEnd: string,
): Promise<DraftLine[]> {
  const commission = await resolveCommissionForPeriod(
    tenantId,
    periodStart,
    periodEnd,
  );
  return withTransaction(async (conn) => {
    const built = await buildDraftLines(
      conn,
      tenantId,
      periodStart,
      periodEnd,
      commission,
    );
    return built.lines;
  });
}

async function buildDraftLines(
  conn: PoolConnection,
  tenantId: number,
  periodStart: string,
  periodEnd: string,
  commission: CommissionOutcome | null,
): Promise<{
  lines: DraftLine[];
  onceOffIds: number[];
  totals: { subtotalCents: number; vatCents: number; totalCents: number };
}> {
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

  // Commission sits immediately under the base fee so the two are read
  // together. Omitted entirely when the sales figure could not be read — the
  // draft is flagged needs_attention instead of being billed a guessed zero.
  if (commission && !commission.needsAttention) {
    const amount = commission.commissionCents ?? 0;
    lines.push({
      description: commissionLineDescription(commission),
      quantity: 1,
      unitCents: amount,
      lineTotalCents: lineTotalCents(1, amount),
    });
  }

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

  return { lines, onceOffIds, totals };
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
  source: "auto" | "manual";
  issue_date: string | null;
  due_date: string | null;
  period_start: string;
  period_end: string;
  subtotal_cents: number;
  vat_cents: number;
  total_cents: number;
  pdf_path: string | null;
  /** Draft cleared for issuing. Null on an unreviewed draft. */
  approved_at: string | null;
  needs_attention: boolean;
  attention_reason: string | null;
};

export async function lockInvoice(
  conn: PoolConnection,
  invoiceId: number,
): Promise<LockedInvoice> {
  const [rows] = await conn.execute<
    (RowDataPacket & LockedInvoice & { source?: string })[]
  >(
    `SELECT id, tenant_id, invoice_number, status, source, issue_date, due_date,
            period_start, period_end, subtotal_cents, vat_cents, total_cents, pdf_path,
            approved_at, needs_attention, attention_reason
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
    source: row.source === "manual" ? "manual" : "auto",
    issue_date: row.issue_date ? String(row.issue_date).slice(0, 10) : null,
    due_date: row.due_date ? String(row.due_date).slice(0, 10) : null,
    period_start: String(row.period_start).slice(0, 10),
    period_end: String(row.period_end).slice(0, 10),
    subtotal_cents: Number(row.subtotal_cents),
    vat_cents: Number(row.vat_cents),
    total_cents: Number(row.total_cents),
    pdf_path: row.pdf_path,
    approved_at: row.approved_at ? String(row.approved_at) : null,
    needs_attention: Boolean(row.needs_attention),
    attention_reason: row.attention_reason ?? null,
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
