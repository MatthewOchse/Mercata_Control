import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { writeAuditLog } from "@/lib/db/audit";
import { query, withTransaction } from "@/lib/db/pool";
import { assertCanTransition } from "@/lib/invoices/invariants";
import { lockInvoice } from "@/lib/invoices/generate";

export type PaymentMethod = "eft" | "payfast" | "debit_order" | "other";

export type RecordPaymentInput = {
  tenantId: number;
  invoiceId: number | null;
  amountCents: number;
  method: PaymentMethod;
  receivedOn: string;
  reference?: string;
  capturedBy: string;
};

export async function allocatedCentsForInvoice(
  invoiceId: number,
): Promise<number> {
  const rows = await query<(RowDataPacket & { total: number })[]>(
    `SELECT COALESCE(SUM(amount_cents), 0) AS total
     FROM payments WHERE invoice_id = :id`,
    { id: invoiceId },
  );
  return Number(rows[0]?.total ?? 0);
}

/**
 * Record a payment. invoiceId null = unallocated.
 * When allocated payments >= invoice total, auto-transition to paid.
 */
export async function recordPayment(
  input: RecordPaymentInput,
): Promise<{ paymentId: number; invoicePaid: boolean; outstandingCents: number | null }> {
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) {
    throw new Error("Payment amount must be a positive integer (cents)");
  }

  return withTransaction(async (conn) => {
    if (input.invoiceId !== null) {
      const inv = await lockInvoice(conn, input.invoiceId);
      if (inv.tenant_id !== input.tenantId) {
        throw new Error("Invoice does not belong to this tenant");
      }
      if (inv.status === "void" || inv.status === "draft") {
        throw new Error(`Cannot allocate payment to ${inv.status} invoice`);
      }
    }

    const [result] = await conn.execute<ResultSetHeader>(
      `INSERT INTO payments
         (tenant_id, invoice_id, amount_cents, method, reference, received_on, captured_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        input.tenantId,
        input.invoiceId,
        input.amountCents,
        input.method,
        input.reference?.trim() || null,
        input.receivedOn,
        input.capturedBy,
      ],
    );
    const paymentId = Number(result.insertId);

    await writeAuditLog(conn, {
      actor: input.capturedBy,
      action: "payment.record",
      entityType: "payment",
      entityId: paymentId,
      after: {
        tenant_id: input.tenantId,
        invoice_id: input.invoiceId,
        amount_cents: input.amountCents,
        method: input.method,
        reference: input.reference ?? null,
      },
    });

    let invoicePaid = false;
    let outstandingCents: number | null = null;

    if (input.invoiceId !== null) {
      const inv = await lockInvoice(conn, input.invoiceId);
      const [sumRows] = await conn.execute<(RowDataPacket & { total: number })[]>(
        `SELECT COALESCE(SUM(amount_cents), 0) AS total
         FROM payments WHERE invoice_id = ?`,
        [input.invoiceId],
      );
      const allocated = Number(sumRows[0]?.total ?? 0);
      outstandingCents = Math.max(0, inv.total_cents - allocated);

      if (
        allocated >= inv.total_cents &&
        (inv.status === "issued" || inv.status === "overdue")
      ) {
        assertCanTransition(inv.status, "paid");
        await conn.execute(`UPDATE invoices SET status = 'paid' WHERE id = ?`, [
          input.invoiceId,
        ]);
        await writeAuditLog(conn, {
          actor: input.capturedBy,
          action: "invoice.paid",
          entityType: "invoice",
          entityId: input.invoiceId,
          before: { status: inv.status },
          after: {
            status: "paid",
            allocated_cents: allocated,
            via: "payment_allocation",
          },
        });
        invoicePaid = true;
        outstandingCents = 0;
      }
    }

    return { paymentId, invoicePaid, outstandingCents };
  });
}

export async function allocatePayment(
  paymentId: number,
  invoiceId: number,
  actor: string,
): Promise<{ invoicePaid: boolean; outstandingCents: number }> {
  return withTransaction(async (conn) => {
    const [pays] = await conn.execute<
      (RowDataPacket & {
        id: number;
        tenant_id: number;
        invoice_id: number | null;
        amount_cents: number;
      })[]
    >(`SELECT id, tenant_id, invoice_id, amount_cents FROM payments WHERE id = ? FOR UPDATE`, [
      paymentId,
    ]);
    const pay = pays[0];
    if (!pay) throw new Error("Payment not found");
    if (pay.invoice_id !== null) {
      throw new Error("Payment is already allocated");
    }

    const inv = await lockInvoice(conn, invoiceId);
    if (inv.tenant_id !== Number(pay.tenant_id)) {
      throw new Error("Invoice tenant mismatch");
    }
    if (inv.status === "void" || inv.status === "draft") {
      throw new Error(`Cannot allocate to ${inv.status} invoice`);
    }

    await conn.execute(`UPDATE payments SET invoice_id = ? WHERE id = ?`, [
      invoiceId,
      paymentId,
    ]);
    await writeAuditLog(conn, {
      actor,
      action: "payment.allocate",
      entityType: "payment",
      entityId: paymentId,
      before: { invoice_id: null },
      after: { invoice_id: invoiceId },
    });

    const [sumRows] = await conn.execute<(RowDataPacket & { total: number })[]>(
      `SELECT COALESCE(SUM(amount_cents), 0) AS total FROM payments WHERE invoice_id = ?`,
      [invoiceId],
    );
    const allocated = Number(sumRows[0]?.total ?? 0);
    let outstandingCents = Math.max(0, inv.total_cents - allocated);
    let invoicePaid = false;

    if (
      allocated >= inv.total_cents &&
      (inv.status === "issued" || inv.status === "overdue")
    ) {
      assertCanTransition(inv.status, "paid");
      await conn.execute(`UPDATE invoices SET status = 'paid' WHERE id = ?`, [
        invoiceId,
      ]);
      invoicePaid = true;
      outstandingCents = 0;
    }

    return { invoicePaid, outstandingCents };
  });
}

export type PaymentListRow = {
  id: number;
  tenant_id: number;
  slug: string;
  trading_name: string;
  invoice_id: number | null;
  invoice_number: string | null;
  amount_cents: number;
  method: string;
  reference: string | null;
  received_on: string;
  captured_by: string;
};

export async function listPayments(): Promise<PaymentListRow[]> {
  const rows = await query<(PaymentListRow & RowDataPacket)[]>(
    `SELECT p.id, p.tenant_id, t.slug, t.trading_name, p.invoice_id,
            i.invoice_number, p.amount_cents, p.method, p.reference,
            p.received_on, p.captured_by
     FROM payments p
     INNER JOIN tenants t ON t.id = p.tenant_id
     LEFT JOIN invoices i ON i.id = p.invoice_id
     ORDER BY p.received_on DESC, p.id DESC`,
  );
  return rows.map((r) => ({
    id: Number(r.id),
    tenant_id: Number(r.tenant_id),
    slug: r.slug,
    trading_name: r.trading_name,
    invoice_id: r.invoice_id === null ? null : Number(r.invoice_id),
    invoice_number: r.invoice_number,
    amount_cents: Number(r.amount_cents),
    method: r.method,
    reference: r.reference,
    received_on: String(r.received_on).slice(0, 10),
    captured_by: r.captured_by,
  }));
}

export async function listTenantsForPaymentSelect(): Promise<
  { id: number; slug: string; trading_name: string }[]
> {
  const rows = await query<
    (RowDataPacket & { id: number; slug: string; trading_name: string })[]
  >(
    `SELECT id, slug, trading_name FROM tenants
     WHERE status IN ('active', 'suspended', 'offboarded')
     ORDER BY trading_name`,
  );
  return rows.map((r) => ({
    id: Number(r.id),
    slug: r.slug,
    trading_name: r.trading_name,
  }));
}

export async function listOpenInvoicesForTenant(
  tenantId: number,
): Promise<{ id: number; invoice_number: string; total_cents: number; status: string }[]> {
  const rows = await query<
    (RowDataPacket & {
      id: number;
      invoice_number: string;
      total_cents: number;
      status: string;
    })[]
  >(
    `SELECT id, invoice_number, total_cents, status FROM invoices
     WHERE tenant_id = :tid
       AND status IN ('issued', 'overdue', 'paid')
       AND invoice_number IS NOT NULL
     ORDER BY issue_date DESC, id DESC`,
    { tid: tenantId },
  );
  return rows.map((r) => ({
    id: Number(r.id),
    invoice_number: r.invoice_number,
    total_cents: Number(r.total_cents),
    status: r.status,
  }));
}
