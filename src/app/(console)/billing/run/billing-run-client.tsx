"use client";

import { useActionState } from "react";
import {
  generateDraftsForPeriodAction,
  issuePeriodDraftsAction,
  type ActionState,
} from "@/app/(console)/billing/actions";
import { Money, StatusPill } from "@/components/ui/status";
import { formatZAR } from "@/lib/money";
import type { BillingPreviewRow } from "@/lib/invoices/queries";

const empty: ActionState = {};

export function BillingRunClient({
  periodStart,
  periodEnd,
  periodLabel,
  rows,
}: {
  periodStart: string;
  periodEnd: string;
  periodLabel: string;
  rows: BillingPreviewRow[];
}) {
  const [genState, genAction, genPending] = useActionState(
    generateDraftsForPeriodAction,
    empty,
  );
  const [issueState, issueAction, issuePending] = useActionState(
    issuePeriodDraftsAction,
    empty,
  );

  const needDrafts = rows.filter((r) => r.existingInvoiceId === null);
  const drafts = rows.filter((r) => r.existingStatus === "draft");
  const issued = rows.filter(
    (r) =>
      r.existingStatus === "issued" ||
      r.existingStatus === "paid" ||
      r.existingStatus === "overdue",
  );

  return (
    <div className="space-y-5">
      <section className="rounded-[4px] border border-border bg-surface p-4">
        <h2 className="text-[15px] font-semibold">
          Billing run — {periodLabel}
        </h2>
        <p className="mt-1 text-[13px] text-muted">
          In advance for{" "}
          <span className="font-mono text-foreground">
            {periodStart} → {periodEnd}
          </span>
          . Drafts are created for review; nothing is issued until you confirm.
        </p>
        <div className="mt-3 flex flex-wrap gap-4 text-[13px]">
          <span>
            Tenants: <strong>{rows.length}</strong>
          </span>
          <span>
            Need draft: <strong>{needDrafts.length}</strong>
          </span>
          <span>
            Drafts ready: <strong>{drafts.length}</strong>
          </span>
          <span>
            Already issued: <strong>{issued.length}</strong>
          </span>
        </div>
      </section>

      <table className="admin-table">
        <thead>
          <tr>
            <th>Tenant</th>
            <th>Plan</th>
            <th className="text-right">Est. total</th>
            <th>Invoice</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.tenantId}>
              <td>
                <div className="font-medium">{r.tradingName}</div>
                <div className="font-mono text-[11px] text-muted">{r.slug}</div>
              </td>
              <td>{r.planName ?? "—"}</td>
              <td className="text-right">
                <Money
                  cents={r.estimatedCents}
                  className="text-accent-strong"
                />
              </td>
              <td>
                {r.existingStatus ? (
                  <StatusPill
                    tone={
                      r.existingStatus === "draft"
                        ? "idle"
                        : r.existingStatus === "paid"
                          ? "ok"
                          : r.existingStatus === "overdue"
                            ? "warn"
                            : "ok"
                    }
                    label={
                      r.existingStatus === "draft"
                        ? `Draft #${r.existingInvoiceId}`
                        : r.existingStatus
                    }
                  />
                ) : (
                  <StatusPill tone="idle" label="No invoice" />
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <section className="rounded-[4px] border border-border bg-surface p-4">
        <h3 className="mb-2 text-[13px] font-semibold">1. Generate drafts</h3>
        <p className="mb-3 text-[12px] text-muted">
          Creates draft invoices for tenants that do not yet have one for this
          period ({needDrafts.length} remaining). Estimated total{" "}
          {formatZAR(
            needDrafts.reduce((s, r) => s + r.estimatedCents, 0),
          )}
          .
        </p>
        <form action={genAction}>
          <input type="hidden" name="period_start" value={periodStart} />
          <input type="hidden" name="period_end" value={periodEnd} />
          <button
            type="submit"
            disabled={genPending || needDrafts.length === 0}
            className="h-8 rounded-[4px] bg-accent-strong px-3 text-[12px] font-semibold text-white disabled:opacity-50"
          >
            {genPending ? "Generating…" : "Generate drafts"}
          </button>
        </form>
        {genState.error ? (
          <p className="mt-2 text-[12px] text-status-error">{genState.error}</p>
        ) : null}
        {genState.message ? (
          <p className="mt-2 text-[12px] text-status-ok">{genState.message}</p>
        ) : null}
      </section>

      <section className="rounded-[4px] border border-border bg-surface p-4">
        <h3 className="mb-2 text-[13px] font-semibold">2. Issue drafts</h3>
        <p className="mb-3 text-[12px] text-muted">
          Allocates gap-free invoice numbers, writes PDFs once, and marks
          invoices issued. Due date = issue date + 7 days.{" "}
          <strong>Never auto-issues</strong> — confirm explicitly.
        </p>
        <form action={issueAction} className="space-y-3">
          <input type="hidden" name="period_start" value={periodStart} />
          <input type="hidden" name="period_end" value={periodEnd} />
          <label className="flex items-start gap-2 text-[12px]">
            <input
              type="checkbox"
              name="confirm_issue"
              className="mt-0.5"
              required
            />
            <span>
              I have reviewed the {drafts.length} draft(s) and confirm issuing
              them for {periodLabel}. This cannot be undone (corrections via
              credit note).
            </span>
          </label>
          <button
            type="submit"
            disabled={issuePending || drafts.length === 0}
            className="h-8 rounded-[4px] border border-status-error px-3 text-[12px] font-semibold text-status-error hover:bg-status-error hover:text-white disabled:opacity-50"
          >
            {issuePending ? "Issuing…" : `Issue ${drafts.length} draft(s)`}
          </button>
        </form>
        {issueState.error ? (
          <p className="mt-2 text-[12px] text-status-error">
            {issueState.error}
          </p>
        ) : null}
        {issueState.message ? (
          <p className="mt-2 text-[12px] text-status-ok">
            {issueState.message}
          </p>
        ) : null}
      </section>
    </div>
  );
}
