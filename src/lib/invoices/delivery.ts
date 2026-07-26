import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Resend } from "resend";
import { writeAuditLog } from "@/lib/db/audit";
import { execute, query, withTransaction } from "@/lib/db/pool";
import type { RowDataPacket } from "mysql2/promise";
import {
  renderInvoiceEmailHtml,
  renderInvoiceEmailSubject,
  renderInvoiceEmailText,
} from "@/lib/invoices/email-template";

function invoiceFrom(): string {
  return (
    process.env.INVOICE_EMAIL_FROM?.trim() ||
    "Mercata Billing <billings@mercata.co.za>"
  );
}

/** Always CC Mercata billing so every outbound invoice is archived in-box. */
function invoiceBillingCc(): string {
  const explicit = process.env.INVOICE_EMAIL_CC?.trim();
  if (explicit) return explicit;
  const from = invoiceFrom();
  const angle = from.match(/<([^>]+)>/);
  return (angle?.[1] ?? from).trim().toLowerCase() || "billings@mercata.co.za";
}

function resendClient(): Resend | null {
  const key = process.env.RESEND_API_KEY?.trim();
  if (!key) return null;
  return new Resend(key);
}

export type SendInvoiceResult =
  | { sent: true; sentAt: string }
  | { sent: false; error: string };

/**
 * Email the issued invoice PDF to the billing contact.
 * On failure the invoice stays issued with sent_at NULL (unsent) — never silent.
 */
export async function sendInvoiceEmail(
  invoiceId: number,
  actor: string,
): Promise<SendInvoiceResult> {
  const rows = await query<
    (RowDataPacket & {
      invoice_number: string | null;
      status: string;
      pdf_path: string | null;
      total_cents: number;
      due_date: string | null;
      issue_date: string | null;
      period_start: string | null;
      period_end: string | null;
      tenant_id: number;
      trading_name: string;
      sent_at: string | null;
    })[]
  >(
    `SELECT i.invoice_number, i.status, i.pdf_path, i.total_cents, i.due_date,
            i.issue_date, i.period_start, i.period_end, i.sent_at, i.tenant_id,
            t.trading_name
     FROM invoices i
     INNER JOIN tenants t ON t.id = i.tenant_id
     WHERE i.id = :id LIMIT 1`,
    { id: invoiceId },
  );
  const inv = rows[0];
  if (!inv) return { sent: false, error: "Invoice not found" };
  if (inv.status !== "issued" && inv.status !== "overdue") {
    return { sent: false, error: `Cannot email invoice in status ${inv.status}` };
  }
  if (!inv.invoice_number || !inv.pdf_path) {
    return { sent: false, error: "Invoice PDF not ready" };
  }

  const invoiceFlagged = await query<
    (RowDataPacket & { email: string; name: string })[]
  >(
    `SELECT email, name FROM tenant_contacts
     WHERE tenant_id = :tid AND receive_invoices = 1
     ORDER BY is_primary DESC, id ASC`,
    { tid: inv.tenant_id },
  );
  const legacyBilling = await query<
    (RowDataPacket & { email: string; name: string })[]
  >(
    `SELECT email, name FROM tenant_contacts
     WHERE tenant_id = :tid AND role = 'billing'
     ORDER BY is_primary DESC, id ASC LIMIT 1`,
    { tid: inv.tenant_id },
  );
  const recipients =
    invoiceFlagged.length > 0 ? invoiceFlagged : legacyBilling;
  if (recipients.length === 0) {
    return { sent: false, error: "No invoice contact email" };
  }

  const client = resendClient();
  if (!client) {
    return { sent: false, error: "RESEND_API_KEY not configured" };
  }

  let pdfBuffer: Buffer;
  try {
    pdfBuffer = await readFile(join(process.cwd(), inv.pdf_path));
  } catch {
    return { sent: false, error: "PDF file missing on disk" };
  }

  const primary = recipients[0]!;
  const mail = {
    recipientName: primary.name,
    tradingName: inv.trading_name,
    invoiceNumber: inv.invoice_number,
    totalCents: Number(inv.total_cents),
    dueDate: inv.due_date ? String(inv.due_date).slice(0, 10) : null,
    issueDate: inv.issue_date ? String(inv.issue_date).slice(0, 10) : null,
    periodStart: inv.period_start
      ? String(inv.period_start).slice(0, 10)
      : null,
    periodEnd: inv.period_end ? String(inv.period_end).slice(0, 10) : null,
  };
  const subject = renderInvoiceEmailSubject(mail);
  const text = renderInvoiceEmailText(mail);
  const html = renderInvoiceEmailHtml(mail);
  const billingCc = invoiceBillingCc();
  const to = [
    ...new Set(recipients.map((r) => r.email.trim()).filter(Boolean)),
  ];
  const cc =
    to.some((e) => e.toLowerCase() === billingCc.toLowerCase())
      ? undefined
      : [billingCc];

  try {
    const { error } = await client.emails.send({
      from: invoiceFrom(),
      to,
      cc,
      subject,
      text,
      html,
      attachments: [
        {
          filename: `${inv.invoice_number}.pdf`,
          content: pdfBuffer,
        },
      ],
    });
    if (error) {
      throw new Error(error.message);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Send failed";
    await withTransaction(async (conn) => {
      await writeAuditLog(conn, {
        actor,
        action: "invoice.send_failed",
        entityType: "invoice",
        entityId: invoiceId,
        after: {
          error: message,
          recipient: to.join(", "),
          cc: cc ?? null,
          invoice_number: inv.invoice_number,
          sent_at: null,
        },
      });
    });
    return { sent: false, error: message };
  }

  await execute(
    `UPDATE invoices SET sent_at = UTC_TIMESTAMP(3) WHERE id = :id`,
    { id: invoiceId },
  );
  await withTransaction(async (conn) => {
    await writeAuditLog(conn, {
      actor,
      action: "invoice.sent",
      entityType: "invoice",
      entityId: invoiceId,
      after: {
        recipient: to.join(", "),
        cc: cc ?? null,
        invoice_number: inv.invoice_number,
      },
    });
  });

  return { sent: true, sentAt: new Date().toISOString() };
}
