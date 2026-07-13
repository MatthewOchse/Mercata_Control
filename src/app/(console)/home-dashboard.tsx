"use client";

import Link from "next/link";
import { useTransition } from "react";
import {
  confirmSuspensionFromTaskAction,
  resendUnsentAction,
  resolveTaskAction,
} from "@/app/(console)/dashboard-actions";
import { Money, StatusPill } from "@/components/ui/status";
import { formatIsoDate } from "@/lib/billing/cycle";
import type {
  DashboardMetrics,
  OperatorTaskRow,
  UnsentInvoice,
} from "@/lib/dashboard/metrics";

export function DashboardClient({
  metrics,
  unsent,
  tasks,
}: {
  metrics: DashboardMetrics;
  unsent: UnsentInvoice[];
  tasks: OperatorTaskRow[];
}) {
  const [pending, startTransition] = useTransition();

  return (
    <div className="space-y-6">
      {unsent.length > 0 ? (
        <section className="rounded-[4px] border-2 border-status-error bg-status-error/10 p-4">
          <div className="mb-2 flex items-center gap-2">
            <StatusPill tone="error" label="Unsent invoices" />
            <h2 className="text-[15px] font-semibold text-status-error">
              {unsent.length} issued invoice{unsent.length === 1 ? "" : "s"} never
              emailed
            </h2>
          </div>
          <p className="mb-3 text-[12px] text-status-error">
            A silently unsent invoice is the worst failure mode. Resend now or
            fix the billing contact / Resend config.
          </p>
          <table className="admin-table">
            <thead>
              <tr>
                <th>Number</th>
                <th>Tenant</th>
                <th>Issued</th>
                <th className="text-right">Total</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {unsent.map((inv) => (
                <tr key={inv.id}>
                  <td>
                    <Link
                      href={`/invoices/${inv.id}`}
                      className="font-mono text-[12px] text-accent-strong"
                    >
                      {inv.invoice_number}
                    </Link>
                  </td>
                  <td>{inv.trading_name}</td>
                  <td className="font-mono text-[12px]">
                    {formatIsoDate(inv.issue_date)}
                  </td>
                  <td className="text-right">
                    <Money cents={inv.total_cents} />
                  </td>
                  <td>
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() =>
                        startTransition(() => {
                          void resendUnsentAction(inv.id);
                        })
                      }
                      className="h-7 rounded-[4px] bg-accent-strong px-2 text-[11px] font-semibold text-white"
                    >
                      Resend
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Metric
          label="MRR"
          value={<Money cents={metrics.mrrCents} className="text-accent-strong" />}
        />
        <Metric
          label="Outstanding"
          value={
            <Money
              cents={metrics.outstandingCents}
              className={
                metrics.outstandingCents > 0
                  ? "text-status-warn"
                  : undefined
              }
            />
          }
        />
        <Metric
          label="Overdue"
          value={
            <span
              className={
                metrics.overdueCount > 0
                  ? "font-semibold text-status-error"
                  : undefined
              }
            >
              {metrics.overdueCount}
            </span>
          }
        />
        <Metric
          label="Awaiting issue"
          value={
            <Link href="/billing/run" className="hover:text-accent-strong">
              {metrics.draftsAwaitingIssue}
            </Link>
          }
        />
        <Metric
          label="Unsent"
          value={
            <span
              className={
                metrics.unsentCount > 0
                  ? "font-semibold text-status-error"
                  : undefined
              }
            >
              {metrics.unsentCount}
            </span>
          }
        />
      </section>

      {tasks.length > 0 ? (
        <section>
          <h2 className="mb-2 text-[12px] font-semibold tracking-wide text-muted uppercase">
            Tasks needing you
          </h2>
          <ul className="space-y-3">
            {tasks.map((task) => (
              <li
                key={task.id}
                className="rounded-[4px] border border-border bg-surface p-4"
              >
                <div className="mb-1 font-medium">{task.title}</div>
                {task.body ? (
                  <p className="mb-3 text-[12px] text-muted">{task.body}</p>
                ) : null}
                <div className="flex flex-wrap gap-2">
                  {task.kind === "confirm_suspension" && task.slug ? (
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() =>
                        startTransition(() => {
                          void confirmSuspensionFromTaskAction(
                            task.id,
                            task.slug!,
                          );
                        })
                      }
                      className="h-8 rounded-[4px] border border-status-error px-3 text-[12px] font-semibold text-status-error hover:bg-status-error hover:text-white"
                    >
                      Confirm suspend
                    </button>
                  ) : null}
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() =>
                      startTransition(() => {
                        void resolveTaskAction(task.id, "done");
                      })
                    }
                    className="h-8 rounded-[4px] border border-border px-3 text-[12px]"
                  >
                    Mark done
                  </button>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() =>
                      startTransition(() => {
                        void resolveTaskAction(task.id, "dismissed");
                      })
                    }
                    className="h-8 rounded-[4px] border border-border px-3 text-[12px] text-muted"
                  >
                    Dismiss
                  </button>
                  {task.invoice_id ? (
                    <Link
                      href={`/invoices/${task.invoice_id}`}
                      className="h-8 px-2 text-[12px] leading-8 text-accent-strong"
                    >
                      View invoice
                    </Link>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function Metric({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="rounded-[4px] border border-border bg-surface p-3">
      <div className="text-[11px] font-semibold tracking-wide text-muted uppercase">
        {label}
      </div>
      <div className="mt-1 text-[18px] font-semibold tabular-nums">{value}</div>
    </div>
  );
}
