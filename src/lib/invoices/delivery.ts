import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Resend } from "resend";
import { writeAuditLog } from "@/lib/db/audit";
import { execute, query, withTransaction } from "@/lib/db/pool";
import type { RowDataPacket } from "mysql2/promise";
import { formatZAR } from "@/lib/money";

function accountsFrom(): string {
  return (
    process.env.INVOICE_EMAIL_FROM?.trim() ||
    "Mercata Accounts <accounts@mercata.co.za>"
  );
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
      tenant_id: number;
      trading_name: string;
      sent_at: string | null;
    })[]
  >(
    `SELECT i.invoice_number, i.status, i.pdf_path, i.total_cents, i.due_date,
            i.issue_date, i.sent_at, i.tenant_id, t.trading_name
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

  const contacts = await query<
    (RowDataPacket & { email: string; name: string })[]
  >(
    `SELECT email, name FROM tenant_contacts
     WHERE tenant_id = :tid AND role = 'billing'
     ORDER BY is_primary DESC, id ASC LIMIT 1`,
    { tid: inv.tenant_id },
  );
  const billing = contacts[0];
  if (!billing?.email) {
    return { sent: false, error: "No billing contact email" };
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

  const subject = `Invoice ${inv.invoice_number} — ${inv.trading_name}`;
  const body = [
    `Hi ${billing.name},`,
    "",
    `Please find invoice ${inv.invoice_number} attached.`,
    `Amount due: ${formatZAR(Number(inv.total_cents))}`,
    inv.due_date ? `Due date: ${String(inv.due_date).slice(0, 10)}` : null,
    "",
    "Pay by EFT using the banking details on the invoice.",
    `Reference: ${inv.invoice_number}`,
    "",
    "Kind regards,",
    "Mercata Accounts",
    "accounts@mercata.co.za",
  ]
    .filter(Boolean)
    .join("\n");

  try {
    const { error } = await client.emails.send({
      from: accountsFrom(),
      to: [billing.email],
      subject,
      text: body,
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
          recipient: billing.email,
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
        recipient: billing.email,
        invoice_number: inv.invoice_number,
      },
    });
  });

  return { sent: true, sentAt: new Date().toISOString() };
}
