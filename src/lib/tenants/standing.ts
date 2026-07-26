import type { RowDataPacket } from "mysql2/promise";
import { sastToday } from "@/lib/billing/cycle";
import { query } from "@/lib/db/pool";
import {
  activeRecurringMrr,
  currentSubscription,
  getAddons,
  getSubscriptions,
} from "@/lib/tenants/queries";

/** Tunable without redeploy (UI standing stages, not dunning_reminders ladder). */
export const DUNNING_THRESHOLDS = {
  reminder: 7,
  chase: 21,
  final: 45,
} as const;

export type DunningStage =
  | "current"
  | "reminder"
  | "chase"
  | "final"
  | "suspend";

export type StandingInvoice = {
  number: string;
  issuedAt: string | null;
  dueAt: string | null;
  amountCents: number;
  status: string;
  daysOverdue: number;
};

export type Standing = {
  balanceCents: number;
  overdueCents: number;
  oldestOverdueDays: number | null;
  dunningStage: DunningStage;
  mrrCents: number;
  nextBillAt: string | null;
  invoices: StandingInvoice[];
};

function stageFromOldest(oldest: number | null): DunningStage {
  if (oldest === null) return "current";
  if (oldest <= DUNNING_THRESHOLDS.reminder) return "reminder";
  if (oldest <= DUNNING_THRESHOLDS.chase) return "chase";
  if (oldest <= DUNNING_THRESHOLDS.final) return "final";
  return "suspend";
}

function nextBillingDate(billingDay: number, today: string): string {
  const day = Math.min(Math.max(1, billingDay), 28);
  const [y, m] = today.split("-").map(Number);
  const thisMonth = `${y}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  if (thisMonth >= today) return thisMonth;
  const next = m === 12 ? { y: y! + 1, m: 1 } : { y: y!, m: m! + 1 };
  return `${next.y}-${String(next.m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export async function getStanding(
  tenantId: number,
  billingDay = 1,
): Promise<Standing> {
  const today = sastToday();
  const rows = await query<
    (RowDataPacket & {
      invoice_number: string | null;
      issue_date: string | null;
      due_date: string | null;
      total_cents: number;
      status: string;
      days_overdue: number;
    })[]
  >(
    `SELECT invoice_number, issue_date, due_date, total_cents, status,
            CASE
              WHEN due_date IS NULL THEN 0
              WHEN status IN ('paid', 'void', 'draft') THEN 0
              ELSE GREATEST(DATEDIFF(:today, due_date), 0)
            END AS days_overdue
     FROM invoices
     WHERE tenant_id = :tenantId
     ORDER BY COALESCE(issue_date, created_at) DESC, id DESC
     LIMIT 12`,
    { tenantId, today },
  );

  const open = rows.filter((i) =>
    i.status === "issued" || i.status === "overdue",
  );
  const overdue = open.filter((i) => Number(i.days_overdue) > 0);
  const oldest = overdue.length
    ? Math.max(...overdue.map((i) => Number(i.days_overdue)))
    : null;

  const [subs, addons] = await Promise.all([
    getSubscriptions(tenantId),
    getAddons(tenantId),
  ]);
  const current = currentSubscription(subs, today);
  const mrrCents =
    (current?.current_monthly_cents ?? 0) + activeRecurringMrr(addons, today);

  return {
    balanceCents: open.reduce((a, i) => a + Number(i.total_cents), 0),
    overdueCents: overdue.reduce((a, i) => a + Number(i.total_cents), 0),
    oldestOverdueDays: oldest,
    dunningStage: stageFromOldest(oldest),
    mrrCents,
    nextBillAt: current ? nextBillingDate(billingDay, today) : null,
    invoices: rows.map((i) => {
      const days = Number(i.days_overdue);
      let status = i.status;
      if (i.status === "paid") status = "paid";
      else if (i.status === "void" || i.status === "draft") status = i.status;
      else if (days > 0) status = "overdue";
      else if (i.status === "issued" || i.status === "overdue") status = "open";
      return {
        number: i.invoice_number ?? "—",
        issuedAt: i.issue_date ? String(i.issue_date).slice(0, 10) : null,
        dueAt: i.due_date ? String(i.due_date).slice(0, 10) : null,
        amountCents: Number(i.total_cents),
        status,
        daysOverdue: days,
      };
    }),
  };
}
