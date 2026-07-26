import { Resend } from "resend";
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { addDaysIso } from "@/lib/invoices/invariants";
import { sastToday } from "@/lib/billing/cycle";
import { writeAuditLog } from "@/lib/db/audit";
import { query, withTransaction } from "@/lib/db/pool";
import { formatZAR } from "@/lib/money";
import { assertCanTransition } from "@/lib/invoices/invariants";

export type DunningStage = "overdue" | "plus_7" | "plus_14" | "plus_21";

type DunningInvoice = {
  id: number;
  tenant_id: number;
  invoice_number: string;
  due_date: string;
  total_cents: number;
  status: string;
  trading_name: string;
  slug: string;
  billing_email: string | null;
  billing_name: string | null;
};

function daysPastDue(dueDate: string, today: string): number {
  const due = new Date(`${dueDate}T00:00:00Z`).getTime();
  const now = new Date(`${today}T00:00:00Z`).getTime();
  return Math.floor((now - due) / (1000 * 60 * 60 * 24));
}

function invoiceFrom(): string {
  return (
    process.env.INVOICE_EMAIL_FROM?.trim() ||
    "Mercata Billing <billings@mercata.co.za>"
  );
}

function operatorCc(): string | null {
  return process.env.ALERT_EMAIL_TO?.trim() || null;
}

async function alreadySent(
  invoiceId: number,
  stage: DunningStage,
): Promise<boolean> {
  const rows = await query<(RowDataPacket & { id: number })[]>(
    `SELECT id FROM dunning_reminders
     WHERE invoice_id = :id AND stage = :stage LIMIT 1`,
    { id: invoiceId, stage },
  );
  return rows.length > 0;
}

async function logReminder(
  invoiceId: number,
  stage: DunningStage,
  recipient: string | null,
): Promise<void> {
  await withTransaction(async (conn) => {
    await conn.execute(
      `INSERT INTO dunning_reminders (invoice_id, stage, recipient)
       VALUES (?, ?, ?)`,
      [invoiceId, stage, recipient],
    );
  });
}

async function sendDunningEmail(opts: {
  to: string;
  cc?: string | null;
  subject: string;
  body: string;
}): Promise<void> {
  const key = process.env.RESEND_API_KEY?.trim();
  if (!key) throw new Error("RESEND_API_KEY not configured");
  const resend = new Resend(key);
  const { error } = await resend.emails.send({
    from: invoiceFrom(),
    to: [opts.to],
    cc: opts.cc ? [opts.cc] : undefined,
    subject: opts.subject,
    text: opts.body,
  });
  if (error) throw new Error(error.message);
}

export type DunningRunSummary = {
  scanned: number;
  overdueMarked: number;
  remindersSent: number;
  tasksCreated: number;
  skipped: number;
  errors: string[];
};

export async function runDunningLadder(
  today = sastToday(),
): Promise<DunningRunSummary> {
  const summary: DunningRunSummary = {
    scanned: 0,
    overdueMarked: 0,
    remindersSent: 0,
    tasksCreated: 0,
    skipped: 0,
    errors: [],
  };

  const rows = await query<(DunningInvoice & RowDataPacket)[]>(
    `SELECT i.id, i.tenant_id, i.invoice_number, i.due_date, i.total_cents, i.status,
            t.trading_name, t.slug,
            (
              SELECT c.email FROM tenant_contacts c
              WHERE c.tenant_id = t.id AND c.role = 'billing'
              ORDER BY c.is_primary DESC, c.id ASC LIMIT 1
            ) AS billing_email,
            (
              SELECT c.name FROM tenant_contacts c
              WHERE c.tenant_id = t.id AND c.role = 'billing'
              ORDER BY c.is_primary DESC, c.id ASC LIMIT 1
            ) AS billing_name
     FROM invoices i
     INNER JOIN tenants t ON t.id = i.tenant_id
     WHERE i.status IN ('issued', 'overdue')
       AND i.due_date IS NOT NULL
       AND i.invoice_number IS NOT NULL
       AND t.status IN ('active', 'suspended')`,
  );

  for (const raw of rows) {
    const inv: DunningInvoice = {
      id: Number(raw.id),
      tenant_id: Number(raw.tenant_id),
      invoice_number: String(raw.invoice_number),
      due_date: String(raw.due_date).slice(0, 10),
      total_cents: Number(raw.total_cents),
      status: raw.status,
      trading_name: raw.trading_name,
      slug: raw.slug,
      billing_email: raw.billing_email,
      billing_name: raw.billing_name,
    };

    const past = daysPastDue(inv.due_date, today);
    if (past < 0) continue;
    summary.scanned++;

    try {
      // Stage overdue: due date passed
      if (past >= 0) {
        if (inv.status === "issued") {
          await withTransaction(async (conn) => {
            assertCanTransition("issued", "overdue");
            await conn.execute(
              `UPDATE invoices SET status = 'overdue' WHERE id = ? AND status = 'issued'`,
              [inv.id],
            );
            await writeAuditLog(conn, {
              actor: "dunning",
              action: "invoice.overdue",
              entityType: "invoice",
              entityId: inv.id,
              before: { status: "issued" },
              after: { status: "overdue", via: "dunning" },
            });
          });
          summary.overdueMarked++;
          inv.status = "overdue";
        }

        if (!(await alreadySent(inv.id, "overdue"))) {
          await sendStageReminder(inv, "overdue");
          summary.remindersSent++;
        }
      }

      if (past >= 7 && !(await alreadySent(inv.id, "plus_7"))) {
        await sendStageReminder(inv, "plus_7");
        summary.remindersSent++;
      }

      if (past >= 14 && !(await alreadySent(inv.id, "plus_14"))) {
        await sendStageReminder(inv, "plus_14");
        summary.remindersSent++;
      }

      if (past >= 21 && !(await alreadySent(inv.id, "plus_21"))) {
        // Do NOT auto-suspend — create operator task.
        await createSuspensionTask(inv);
        await logReminder(inv.id, "plus_21", null);
        await withTransaction(async (conn) => {
          await writeAuditLog(conn, {
            actor: "dunning",
            action: "dunning.plus_21_task",
            entityType: "invoice",
            entityId: inv.id,
            after: {
              invoice_number: inv.invoice_number,
              tenant_id: inv.tenant_id,
              note: "Manual suspension confirmation required — no auto-suspend",
            },
          });
        });
        summary.tasksCreated++;
      }
    } catch (err) {
      summary.errors.push(
        `${inv.invoice_number}: ${err instanceof Error ? err.message : "failed"}`,
      );
    }
  }

  return summary;
}

async function sendStageReminder(
  inv: DunningInvoice,
  stage: Exclude<DunningStage, "plus_21">,
): Promise<void> {
  if (!inv.billing_email) {
    throw new Error("No billing contact");
  }

  const suspensionDate = addDaysIso(inv.due_date, 21);
  const name = inv.billing_name || "there";
  const amount = formatZAR(inv.total_cents);

  let subject: string;
  let body: string;
  let cc: string | null = null;

  if (stage === "overdue") {
    subject = `Friendly reminder — invoice ${inv.invoice_number}`;
    body = [
      `Hi ${name},`,
      "",
      `This is a polite reminder that invoice ${inv.invoice_number} for ${amount}`,
      `was due on ${inv.due_date} and appears unpaid.`,
      "",
      "If you have already paid, thank you — please ignore this note.",
      "Otherwise, please settle at your earliest convenience using the EFT",
      `details on the invoice (reference ${inv.invoice_number}).`,
      "",
      "Kind regards,",
      "Mercata Accounts",
    ].join("\n");
  } else if (stage === "plus_7") {
    subject = `Second reminder — invoice ${inv.invoice_number}`;
    cc = operatorCc();
    body = [
      `Hi ${name},`,
      "",
      `A second reminder: invoice ${inv.invoice_number} (${amount}) for ${inv.trading_name}`,
      `is now more than 7 days past due (due ${inv.due_date}).`,
      "",
      "Please arrange payment or get in touch if there is an issue.",
      "",
      "Kind regards,",
      "Mercata Accounts",
    ].join("\n");
  } else {
    subject = `Final notice — invoice ${inv.invoice_number}`;
    body = [
      `Hi ${name},`,
      "",
      `Final notice: invoice ${inv.invoice_number} (${amount}) remains unpaid.`,
      `Due date was ${inv.due_date}.`,
      "",
      `If payment is not received, service suspension may be considered on ${suspensionDate}.`,
      "Please contact us urgently if you need to discuss arrangements.",
      "",
      "Kind regards,",
      "Mercata Accounts",
    ].join("\n");
  }

  await sendDunningEmail({
    to: inv.billing_email,
    cc,
    subject,
    body,
  });
  await logReminder(inv.id, stage, inv.billing_email);
}

async function createSuspensionTask(inv: DunningInvoice): Promise<void> {
  // Avoid duplicate open tasks for the same invoice
  const existing = await query<(RowDataPacket & { id: number })[]>(
    `SELECT id FROM operator_tasks
     WHERE kind = 'confirm_suspension'
       AND invoice_id = :id
       AND status = 'open'
     LIMIT 1`,
    { id: inv.id },
  );
  if (existing[0]) return;

  await withTransaction(async (conn) => {
    await conn.execute<ResultSetHeader>(
      `INSERT INTO operator_tasks
         (kind, tenant_id, invoice_id, title, body, status)
       VALUES (?, ?, ?, ?, ?, 'open')`,
      [
        "confirm_suspension",
        inv.tenant_id,
        inv.id,
        `Confirm suspension — ${inv.trading_name}`,
        `Invoice ${inv.invoice_number} is 21+ days overdue (${formatZAR(inv.total_cents)}). ` +
          `Do not auto-suspend: confirm manually if appropriate. Tenant: ${inv.slug}.`,
      ],
    );
  });
}
