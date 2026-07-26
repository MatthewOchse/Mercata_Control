import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { dueDateForBillingDay, sastToday } from "@/lib/billing/cycle";
import { writeAuditLog } from "@/lib/db/audit";
import { execute, query, withTransaction } from "@/lib/db/pool";
import {
  assertCanTransition,
  assertDraftMutable,
  type InvoiceStatus,
} from "@/lib/invoices/invariants";
import { generateInvoiceForTenant, lockInvoice } from "@/lib/invoices/generate";
import { allocateSequenceNumber } from "@/lib/invoices/numbers";
import { yearFromIso } from "@/lib/invoices/period";
import { renderInvoicePdf } from "@/lib/invoices/pdf";

async function loadPdfPayload(invoiceId: number, inv: {
  tenant_id: number;
  period_start: string;
  period_end: string;
  subtotal_cents: number;
  vat_cents: number;
  total_cents: number;
}) {
  const tenantRows = await query<
    (RowDataPacket & {
      legal_name: string;
      trading_name: string;
      vat_number: string | null;
    })[]
  >(
    `SELECT legal_name, trading_name, vat_number FROM tenants WHERE id = :id`,
    { id: inv.tenant_id },
  );
  const tenant = tenantRows[0];
  if (!tenant) throw new Error("Tenant missing");

  const contacts = await query<(RowDataPacket & { email: string })[]>(
    `SELECT email FROM tenant_contacts
     WHERE tenant_id = :id AND role = 'billing'
     ORDER BY id LIMIT 1`,
    { id: inv.tenant_id },
  );

  const lines = await query<
    (RowDataPacket & {
      description: string;
      quantity: number;
      unit_cents: number;
      line_total_cents: number;
    })[]
  >(
    `SELECT description, quantity, unit_cents, line_total_cents
     FROM invoice_lines WHERE invoice_id = :id ORDER BY sort_order, id`,
    { id: invoiceId },
  );

  return {
    customer: {
      legalName: tenant.legal_name,
      tradingName: tenant.trading_name,
      vatNumber: tenant.vat_number,
      email: contacts[0]?.email ?? null,
    },
    lines: lines.map((l) => ({
      description: l.description,
      quantity: Number(l.quantity),
      unitCents: Number(l.unit_cents),
      lineTotalCents: Number(l.line_total_cents),
    })),
    periodStart: inv.period_start,
    periodEnd: inv.period_end,
    subtotalCents: inv.subtotal_cents,
    vatCents: inv.vat_cents,
    totalCents: inv.total_cents,
  };
}

export async function issueInvoice(
  invoiceId: number,
  actor: string,
  issueDate = sastToday(),
): Promise<{
  invoiceNumber: string;
  pdfPath: string;
  emailed: boolean;
  emailError?: string;
}> {
  const year = yearFromIso(issueDate);

  const issued = await withTransaction(async (conn) => {
    const inv = await lockInvoice(conn, invoiceId);
    assertDraftMutable(inv.status);
    assertCanTransition("draft", "issued");

    // Review gate: a draft must be explicitly approved, and one flagged for
    // attention (e.g. an unreadable sales figure) can never be issued.
    if (inv.needs_attention) {
      throw new Error(
        `Draft needs attention and cannot be issued: ${
          inv.attention_reason ?? "unresolved problem"
        }`,
      );
    }
    if (!inv.approved_at) {
      throw new Error(
        "Draft has not been approved. Approve it on the billing run before issuing.",
      );
    }

    const [tenants] = await conn.execute<
      (RowDataPacket & { billing_day: number })[]
    >(`SELECT billing_day FROM tenants WHERE id = ? LIMIT 1`, [inv.tenant_id]);
    const billingDay = Number(tenants[0]?.billing_day ?? 1);
    const dueDate = dueDateForBillingDay(
      issueDate,
      inv.period_start,
      billingDay,
    );

    const { formatted: invoiceNumber } = await allocateSequenceNumber(
      conn,
      "invoice",
      year,
    );

    await conn.execute(
      `UPDATE invoices
       SET status = 'issued',
           invoice_number = ?,
           issue_date = ?,
           due_date = ?,
           issued_at = UTC_TIMESTAMP(3)
       WHERE id = ?`,
      [invoiceNumber, issueDate, dueDate, invoiceId],
    );

    await writeAuditLog(conn, {
      actor,
      action: "invoice.issue",
      entityType: "invoice",
      entityId: invoiceId,
      before: { status: "draft", invoice_number: null },
      after: {
        status: "issued",
        invoice_number: invoiceNumber,
        due_date: dueDate,
        billing_day: billingDay,
      },
    });

    return { inv, invoiceNumber, dueDate };
  });

  const payload = await loadPdfPayload(invoiceId, issued.inv);
  const pdf = await renderInvoicePdf({
    invoiceNumber: issued.invoiceNumber,
    issueDate,
    dueDate: issued.dueDate,
    ...payload,
  });

  await execute(
    `UPDATE invoices SET pdf_path = :path WHERE id = :id AND pdf_path IS NULL`,
    { path: pdf.relativePath, id: invoiceId },
  );

  await withTransaction(async (conn) => {
    await writeAuditLog(conn, {
      actor,
      action: "invoice.pdf_written",
      entityType: "invoice",
      entityId: invoiceId,
      after: {
        pdf_path: pdf.relativePath,
        invoice_number: issued.invoiceNumber,
      },
    });
  });

  // Delivery — failure leaves issued + sent_at NULL (loudly unsent on dashboard).
  const { sendInvoiceEmail } = await import("@/lib/invoices/delivery");
  const delivery = await sendInvoiceEmail(invoiceId, actor);

  return {
    invoiceNumber: issued.invoiceNumber,
    pdfPath: pdf.relativePath,
    emailed: delivery.sent,
    emailError: delivery.sent ? undefined : delivery.error,
  };
}

/**
 * Rewrite the PDF for an already-issued invoice (same numbers/lines).
 * Used only when the template changes — does not alter legal totals.
 */
export async function rewriteIssuedInvoicePdf(
  invoiceId: number,
  actor: string,
): Promise<{ pdfPath: string }> {
  const rows = await query<
    (RowDataPacket & {
      invoice_number: string | null;
      status: InvoiceStatus;
      issue_date: string | null;
      due_date: string | null;
      tenant_id: number;
      period_start: string;
      period_end: string;
      subtotal_cents: number;
      vat_cents: number;
      total_cents: number;
    })[]
  >(
    `SELECT invoice_number, status, issue_date, due_date, tenant_id,
            period_start, period_end, subtotal_cents, vat_cents, total_cents
     FROM invoices WHERE id = :id LIMIT 1`,
    { id: invoiceId },
  );
  const inv = rows[0];
  if (!inv?.invoice_number || !inv.issue_date || !inv.due_date) {
    throw new Error("Issued invoice with number required");
  }
  if (
    inv.status !== "issued" &&
    inv.status !== "overdue" &&
    inv.status !== "paid"
  ) {
    throw new Error(`Cannot rewrite PDF for status ${inv.status}`);
  }

  const payload = await loadPdfPayload(invoiceId, {
    tenant_id: Number(inv.tenant_id),
    period_start: String(inv.period_start).slice(0, 10),
    period_end: String(inv.period_end).slice(0, 10),
    subtotal_cents: Number(inv.subtotal_cents),
    vat_cents: Number(inv.vat_cents),
    total_cents: Number(inv.total_cents),
  });

  const pdf = await renderInvoicePdf(
    {
      invoiceNumber: inv.invoice_number,
      issueDate: String(inv.issue_date).slice(0, 10),
      dueDate: String(inv.due_date).slice(0, 10),
      ...payload,
    },
    { replaceExisting: true },
  );

  await execute(`UPDATE invoices SET pdf_path = :path WHERE id = :id`, {
    path: pdf.relativePath,
    id: invoiceId,
  });

  await withTransaction(async (conn) => {
    await writeAuditLog(conn, {
      actor,
      action: "invoice.pdf_rewritten",
      entityType: "invoice",
      entityId: invoiceId,
      after: {
        pdf_path: pdf.relativePath,
        invoice_number: inv.invoice_number,
        reason: "template_update",
      },
    });
  });

  return { pdfPath: pdf.relativePath };
}

export async function transitionInvoiceStatus(
  invoiceId: number,
  to: InvoiceStatus,
  actor: string,
): Promise<void> {
  await withTransaction(async (conn) => {
    const inv = await lockInvoice(conn, invoiceId);
    assertCanTransition(inv.status, to);

    await conn.execute(`UPDATE invoices SET status = ? WHERE id = ?`, [
      to,
      invoiceId,
    ]);

    await writeAuditLog(conn, {
      actor,
      action: `invoice.${to}`,
      entityType: "invoice",
      entityId: invoiceId,
      before: { status: inv.status, invoice_number: inv.invoice_number },
      after: { status: to, invoice_number: inv.invoice_number },
    });
  });
}

export async function voidInvoice(
  invoiceId: number,
  actor: string,
): Promise<void> {
  await transitionInvoiceStatus(invoiceId, "void", actor);
}

export async function markInvoicePaid(
  invoiceId: number,
  actor: string,
): Promise<void> {
  await transitionInvoiceStatus(invoiceId, "paid", actor);
}

export async function markInvoiceOverdue(
  invoiceId: number,
  actor: string,
): Promise<void> {
  await transitionInvoiceStatus(invoiceId, "overdue", actor);
}

/**
 * Correct an issued invoice: credit note (keeps original number forever on the
 * voided invoice) + fresh draft for the same period.
 */
export async function issueCreditNote(opts: {
  invoiceId: number;
  reason: string;
  actor: string;
  generateReplacementDraft?: boolean;
}): Promise<{
  creditNoteNumber: string;
  creditNoteId: number;
  replacementInvoiceId?: number;
}> {
  const meta = await withTransaction(async (conn) => {
    const inv = await lockInvoice(conn, opts.invoiceId);
    if (
      inv.status !== "issued" &&
      inv.status !== "paid" &&
      inv.status !== "overdue"
    ) {
      throw new Error(
        "Credit notes apply to issued/paid/overdue invoices only",
      );
    }
    if (!inv.invoice_number) {
      throw new Error("Invoice has no number");
    }

    const year = yearFromIso(sastToday());
    const { formatted: creditNoteNumber } = await allocateSequenceNumber(
      conn,
      "credit_note",
      year,
    );

    const [cnResult] = await conn.execute<ResultSetHeader>(
      `INSERT INTO credit_notes
         (credit_note_number, invoice_id, reason, total_cents, issued_at)
       VALUES (?, ?, ?, ?, UTC_TIMESTAMP(3))`,
      [
        creditNoteNumber,
        opts.invoiceId,
        opts.reason.trim(),
        inv.total_cents,
      ],
    );
    const creditNoteId = Number(cnResult.insertId);

    await writeAuditLog(conn, {
      actor: opts.actor,
      action: "credit_note.issue",
      entityType: "credit_note",
      entityId: creditNoteId,
      after: {
        credit_note_number: creditNoteNumber,
        invoice_id: opts.invoiceId,
        invoice_number: inv.invoice_number,
        total_cents: inv.total_cents,
        reason: opts.reason.trim(),
      },
    });

    assertCanTransition(inv.status, "void");
    await conn.execute(`UPDATE invoices SET status = 'void' WHERE id = ?`, [
      opts.invoiceId,
    ]);
    await writeAuditLog(conn, {
      actor: opts.actor,
      action: "invoice.void",
      entityType: "invoice",
      entityId: opts.invoiceId,
      before: { status: inv.status, invoice_number: inv.invoice_number },
      after: {
        status: "void",
        invoice_number: inv.invoice_number,
        via: "credit_note",
        credit_note_number: creditNoteNumber,
      },
    });

    return {
      creditNoteNumber,
      creditNoteId,
      tenantId: inv.tenant_id,
      periodStart: inv.period_start,
      periodEnd: inv.period_end,
    };
  });

  let replacementInvoiceId: number | undefined;
  if (opts.generateReplacementDraft) {
    const gen = await generateInvoiceForTenant(
      meta.tenantId,
      meta.periodStart,
      meta.periodEnd,
      opts.actor,
    );
    replacementInvoiceId = gen.invoiceId;
  }

  return {
    creditNoteNumber: meta.creditNoteNumber,
    creditNoteId: meta.creditNoteId,
    replacementInvoiceId,
  };
}
