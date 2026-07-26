import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { writeAuditLog } from "@/lib/db/audit";
import { withTransaction, type PoolConnection } from "@/lib/db/pool";
import { isVatRegistered } from "@/lib/env";
import {
  assertDraftMutable,
  computeInvoiceTotals,
} from "@/lib/invoices/invariants";
import {
  lockInvoice,
  previewSourceLines,
  type DraftLine,
  type GenerateResult,
} from "@/lib/invoices/generate";
import { lineTotalCents } from "@/lib/money";

export type ManualLineInput = {
  description: string;
  quantity: number;
  unitCents: number;
};

function normaliseLines(raw: ManualLineInput[]): DraftLine[] {
  const lines: DraftLine[] = [];
  for (const row of raw) {
    const description = row.description.trim();
    if (!description) continue;
    const quantity = Number(row.quantity);
    const unitCents = Number(row.unitCents);
    if (!Number.isInteger(quantity) || quantity < 1) {
      throw new Error("Quantity must be a positive integer");
    }
    if (!Number.isInteger(unitCents)) {
      throw new Error("Unit amount must be integer cents");
    }
    lines.push({
      description,
      quantity,
      unitCents,
      lineTotalCents: lineTotalCents(quantity, unitCents),
    });
  }
  if (lines.length === 0) {
    throw new Error("At least one line item is required");
  }
  return lines;
}

async function writeLines(
  conn: PoolConnection,
  invoiceId: number,
  lines: DraftLine[],
): Promise<void> {
  await conn.execute(`DELETE FROM invoice_lines WHERE invoice_id = ?`, [
    invoiceId,
  ]);
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
}

/**
 * Create a locked manual draft for a calendar period.
 * Optionally seeds lines from package + expenses.
 */
export async function createManualDraftInvoice(opts: {
  tenantId: number;
  periodStart: string;
  periodEnd: string;
  actor: string;
  seedFromSources: boolean;
  lines?: ManualLineInput[];
}): Promise<GenerateResult> {
  const { tenantId, periodStart, periodEnd, actor, seedFromSources } = opts;

  let lines: DraftLine[];
  if (seedFromSources && (!opts.lines || opts.lines.length === 0)) {
    lines = await previewSourceLines(tenantId, periodStart, periodEnd);
  } else if (opts.lines && opts.lines.length > 0) {
    lines = normaliseLines(opts.lines);
  } else if (seedFromSources) {
    lines = await previewSourceLines(tenantId, periodStart, periodEnd);
  } else {
    throw new Error("Provide line items or enable seed from package & expenses");
  }

  const totals = computeInvoiceTotals(
    lines.map((l) => l.lineTotalCents),
    isVatRegistered(),
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
        `Cannot invoice tenant in status ${tenant.status}`,
      );
    }

    const [existing] = await conn.execute<(RowDataPacket & { id: number; status: string })[]>(
      `SELECT id, status FROM invoices
       WHERE tenant_id = ? AND period_start = ? AND period_end = ?
         AND status IN ('draft', 'issued', 'paid', 'overdue')
       LIMIT 1`,
      [tenantId, periodStart, periodEnd],
    );
    if (existing[0]) {
      throw new Error(
        `Invoice already exists for this period (id=${existing[0].id}, ${existing[0].status}). Delete the draft first if you want a custom invoice.`,
      );
    }

    const [invResult] = await conn.execute<ResultSetHeader>(
      `INSERT INTO invoices
         (tenant_id, invoice_number, status, source, period_start, period_end,
          subtotal_cents, vat_cents, total_cents)
       VALUES (?, NULL, 'draft', 'manual', ?, ?, ?, ?, ?)`,
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

    await writeLines(conn, invoiceId, lines);

    // Mark overlapping unbilled once-offs as billed against this draft when seeded
    // or when lines were copied from sources (addon ids may be absent on freeform).
    if (seedFromSources) {
      const onceOffIds = lines
        .map((l) => l.addonId)
        .filter((id): id is number => typeof id === "number");
      // Re-query unbilled once-offs for the period and link them
      const [onceOffs] = await conn.execute<(RowDataPacket & { id: number })[]>(
        `SELECT id FROM addons
         WHERE tenant_id = ?
           AND kind = 'once_off'
           AND billed_invoice_id IS NULL
           AND active_from <= ?
           AND (active_until IS NULL OR active_until >= ?)`,
        [tenantId, periodEnd, periodStart],
      );
      const ids = onceOffs.map((r) => Number(r.id));
      void onceOffIds;
      if (ids.length > 0) {
        await conn.execute(
          `UPDATE addons SET billed_invoice_id = ?
           WHERE id IN (${ids.map(() => "?").join(",")})`,
          [invoiceId, ...ids],
        );
      }
    }

    await writeAuditLog(conn, {
      actor,
      action: "invoice.create_manual_draft",
      entityType: "invoice",
      entityId: invoiceId,
      after: {
        tenant_id: tenantId,
        period_start: periodStart,
        period_end: periodEnd,
        total_cents: totals.totalCents,
        line_count: lines.length,
        seeded: seedFromSources,
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

/** Replace lines on a manual draft only. */
export async function updateManualDraftLines(
  invoiceId: number,
  rawLines: ManualLineInput[],
  actor: string,
): Promise<GenerateResult> {
  const lines = normaliseLines(rawLines);
  const totals = computeInvoiceTotals(
    lines.map((l) => l.lineTotalCents),
    isVatRegistered(),
  );

  return withTransaction(async (conn) => {
    const inv = await lockInvoice(conn, invoiceId);
    assertDraftMutable(inv.status);
    if (inv.source !== "manual") {
      throw new Error("Only custom (manual) drafts can have their lines edited");
    }

    await writeLines(conn, invoiceId, lines);
    await conn.execute(
      `UPDATE invoices
       SET subtotal_cents = ?, vat_cents = ?, total_cents = ?
       WHERE id = ?`,
      [totals.subtotalCents, totals.vatCents, totals.totalCents, invoiceId],
    );

    await writeAuditLog(conn, {
      actor,
      action: "invoice.update_manual_lines",
      entityType: "invoice",
      entityId: invoiceId,
      after: {
        total_cents: totals.totalCents,
        line_count: lines.length,
      },
    });

    return {
      invoiceId,
      tenantId: inv.tenant_id,
      periodStart: inv.period_start,
      periodEnd: inv.period_end,
      subtotalCents: totals.subtotalCents,
      vatCents: totals.vatCents,
      totalCents: totals.totalCents,
      lines,
    };
  });
}

/**
 * Persist a tenant expense and append it as a line on a manual draft.
 * Once-offs are marked billed against this invoice.
 */
export async function addExpenseToManualDraft(opts: {
  invoiceId: number;
  slug: string;
  description: string;
  kind: "recurring" | "once_off";
  amountCents: number;
  actor: string;
}): Promise<{ invoiceId: number; addonId: number }> {
  const { addAddon } = await import("@/lib/tenants/service");
  const { getInvoiceById } = await import("@/lib/invoices/queries");

  const before = await getInvoiceById(opts.invoiceId);
  if (!before || before.status !== "draft" || before.source !== "manual") {
    throw new Error("Expense can only be added to a custom draft invoice");
  }

  const addon = await addAddon(
    opts.slug,
    {
      description: opts.description,
      kind: opts.kind,
      amountCents: opts.amountCents,
    },
    opts.actor,
  );
  void addon;

  // addAddon rebuilds auto drafts only; append line to this manual draft.
  const existingLines = before.lines.map((l) => ({
    description: l.description,
    quantity: l.quantity,
    unitCents: l.unit_cents,
  }));
  existingLines.push({
    description: opts.description.trim(),
    quantity: 1,
    unitCents: opts.amountCents,
  });
  await updateManualDraftLines(opts.invoiceId, existingLines, opts.actor);

  // Link once-off to this invoice if we can find the newest matching addon
  let addonId = 0;
  if (opts.kind === "once_off") {
    addonId = await withTransaction(async (conn) => {
      const [rows] = await conn.execute<(RowDataPacket & { id: number })[]>(
        `SELECT id FROM addons
         WHERE tenant_id = ? AND kind = 'once_off' AND description = ?
           AND amount_cents = ? AND billed_invoice_id IS NULL
         ORDER BY id DESC LIMIT 1`,
        [before.tenant_id, opts.description.trim(), opts.amountCents],
      );
      const id = rows[0]?.id;
      if (id) {
        await conn.execute(
          `UPDATE addons SET billed_invoice_id = ? WHERE id = ?`,
          [opts.invoiceId, id],
        );
        return Number(id);
      }
      return 0;
    });
  }

  return { invoiceId: opts.invoiceId, addonId };
}
