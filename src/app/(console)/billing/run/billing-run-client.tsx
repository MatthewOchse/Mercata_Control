"use client";

import { useActionState, useState, useTransition } from "react";
import {
  approveOneAction,
  approvePeriodDraftsAction,
  generateDraftsForPeriodAction,
  issuePeriodDraftsAction,
  refreshSalesForPeriodAction,
  setManualSalesAction,
  unapproveOneAction,
  waiveCommissionAction,
  type ActionState,
} from "@/app/(console)/billing/actions";
import { Money, StatusPill } from "@/components/ui/status";
import { formatZAR } from "@/lib/money";
import type { BillingPreviewRow } from "@/lib/invoices/queries";

const empty: ActionState = {};

function Banner({ state }: { state: ActionState }) {
  if (state.error) {
    return (
      <div className="rounded-[4px] border border-status-error bg-status-error/10 p-3 text-[12px] text-status-error">
        {state.error}
      </div>
    );
  }
  if (state.message) {
    return (
      <div className="rounded-[4px] border border-status-ok bg-status-ok/10 p-3 text-[12px] text-status-ok">
        {state.message}
      </div>
    );
  }
  return null;
}

function invoiceTone(
  row: BillingPreviewRow,
): { tone: "ok" | "warn" | "error" | "idle"; label: string } {
  if (!row.existingStatus) return { tone: "idle", label: "No invoice" };
  if (row.existingStatus === "draft") {
    if (row.existingNeedsAttention) {
      return { tone: "error", label: "Needs attention" };
    }
    return row.existingApproved
      ? { tone: "ok", label: `Approved #${row.existingInvoiceId}` }
      : { tone: "warn", label: `Draft #${row.existingInvoiceId}` };
  }
  if (row.existingStatus === "paid") return { tone: "ok", label: "Paid" };
  if (row.existingStatus === "overdue") return { tone: "error", label: "Overdue" };
  return { tone: "ok", label: "Issued" };
}

function SalesCell({ row, salesLabel }: { row: BillingPreviewRow; salesLabel: string }) {
  if (row.commissionRate <= 0) {
    return <span className="text-[11px] text-muted">n/a — flat plan</span>;
  }
  if (row.salesOk === null) {
    return (
      <span className="text-[11px] text-status-warn">
        Not read for {salesLabel}
      </span>
    );
  }
  if (!row.salesOk) {
    return (
      <span className="text-[11px] text-status-error" title={row.salesError ?? ""}>
        Unavailable
      </span>
    );
  }
  return (
    <div>
      <Money cents={row.salesGrossCents ?? 0} className="text-[12px]" />
      <div className="text-[10px] text-muted">{salesSourceLabel(row.salesSource)}</div>
      {row.salesError ? (
        <div className="text-[10px] text-status-warn" title={row.salesError}>
          last refresh failed
        </div>
      ) : null}
    </div>
  );
}

function salesSourceLabel(source: string | null): string {
  switch (source) {
    case "fleet":
      return "read live";
    case "manual":
      return "entered by hand";
    case "cached":
      return "measured at month close";
    case "warehouse":
      return "from nightly analytics";
    default:
      return source ?? "unknown source";
  }
}

function RowActions({ row }: { row: BillingPreviewRow }) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<ActionState>({});

  if (row.existingStatus !== "draft" || !row.existingInvoiceId) return null;
  const invoiceId = row.existingInvoiceId;

  return (
    <div className="flex flex-col items-end gap-1">
      {row.existingNeedsAttention ? (
        <span className="text-[10px] text-status-error">Resolve below</span>
      ) : row.existingApproved ? (
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            start(async () => setResult(await unapproveOneAction(invoiceId)))
          }
          className="text-[11px] text-muted hover:underline disabled:opacity-50"
        >
          Withdraw
        </button>
      ) : (
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            start(async () => setResult(await approveOneAction(invoiceId)))
          }
          className="text-[11px] font-semibold text-accent-strong hover:underline disabled:opacity-50"
        >
          Approve
        </button>
      )}
      <a
        href={`/invoices/${invoiceId}`}
        className="text-[11px] text-muted hover:underline"
      >
        Open
      </a>
      {result.error ? (
        <span className="text-[10px] text-status-error">{result.error}</span>
      ) : null}
    </div>
  );
}

function AttentionPanel({
  rows,
  salesLabel,
}: {
  rows: BillingPreviewRow[];
  salesLabel: string;
}) {
  const [manualState, manualAction, manualPending] = useActionState(
    setManualSalesAction,
    empty,
  );
  const [waiveState, waiveAction, waivePending] = useActionState(
    waiveCommissionAction,
    empty,
  );

  if (rows.length === 0) return null;

  return (
    <section className="space-y-3 rounded-[4px] border border-status-error bg-status-error/5 p-4">
      <div>
        <h3 className="text-[13px] font-semibold text-status-error">
          {rows.length} draft(s) need attention
        </h3>
        <p className="mt-1 text-[12px] text-muted">
          These tenants earn commission but their {salesLabel} sales figure could
          not be read. They have been drafted with the base fee only and{" "}
          <strong>cannot be approved or issued</strong> until you resolve them.
          A missing figure is never treated as zero sales.
        </p>
      </div>

      <Banner state={manualState.error || manualState.message ? manualState : waiveState} />

      {rows.map((row) => (
        <div
          key={row.tenantId}
          className="rounded-[4px] border border-border bg-surface p-3"
        >
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div>
              <span className="text-[13px] font-medium">{row.tradingName}</span>
              <span className="ml-2 font-mono text-[11px] text-muted">
                {row.slug}
              </span>
            </div>
            <span className="text-[11px] text-status-error">
              {row.existingAttentionReason ?? row.salesError ?? "Sales unavailable"}
            </span>
          </div>

          <div className="mt-2 flex flex-wrap items-end gap-4">
            <form action={manualAction} className="flex items-end gap-2">
              <input
                type="hidden"
                name="invoice_id"
                value={row.existingInvoiceId ?? ""}
              />
              <label className="flex flex-col gap-1 text-[11px]">
                <span className="text-muted uppercase">
                  {salesLabel} gross sales (R)
                </span>
                <input
                  name="gross"
                  required
                  placeholder="e.g. 64500.00"
                  className="h-8 w-[11rem] rounded-[4px] border border-border px-2 text-right font-mono text-[12px]"
                />
              </label>
              <button
                type="submit"
                disabled={manualPending}
                className="h-8 rounded-[4px] bg-accent-strong px-3 text-[11px] font-semibold text-white disabled:opacity-50"
              >
                {manualPending ? "Saving…" : "Use this figure"}
              </button>
            </form>

            <form action={waiveAction} className="flex items-end gap-2">
              <input
                type="hidden"
                name="invoice_id"
                value={row.existingInvoiceId ?? ""}
              />
              <label className="flex flex-col gap-1 text-[11px]">
                <span className="text-muted uppercase">
                  Or waive commission — reason
                </span>
                <input
                  name="reason"
                  required
                  placeholder="Why no commission this month"
                  className="h-8 w-[16rem] rounded-[4px] border border-border px-2 text-[12px]"
                />
              </label>
              <button
                type="submit"
                disabled={waivePending}
                className="h-8 rounded-[4px] border border-border px-3 text-[11px] font-semibold hover:border-status-error hover:text-status-error disabled:opacity-50"
              >
                {waivePending ? "Waiving…" : "Waive"}
              </button>
            </form>
          </div>
        </div>
      ))}
    </section>
  );
}

export function BillingRunClient({
  periodStart,
  periodEnd,
  periodLabel,
  salesLabel,
  rows,
}: {
  periodStart: string;
  periodEnd: string;
  periodLabel: string;
  salesLabel: string;
  rows: BillingPreviewRow[];
}) {
  const [genState, genAction, genPending] = useActionState(
    generateDraftsForPeriodAction,
    empty,
  );
  const [salesState, salesAction, salesPending] = useActionState(
    refreshSalesForPeriodAction,
    empty,
  );
  const [approveState, approveAction, approvePending] = useActionState(
    approvePeriodDraftsAction,
    empty,
  );
  const [issueState, issueAction, issuePending] = useActionState(
    issuePeriodDraftsAction,
    empty,
  );

  const needDrafts = rows.filter((r) => r.existingInvoiceId === null);
  const drafts = rows.filter((r) => r.existingStatus === "draft");
  const attention = drafts.filter((r) => r.existingNeedsAttention);
  const awaitingApproval = drafts.filter(
    (r) => !r.existingApproved && !r.existingNeedsAttention,
  );
  const approved = drafts.filter(
    (r) => r.existingApproved && !r.existingNeedsAttention,
  );
  const issued = rows.filter(
    (r) =>
      r.existingStatus === "issued" ||
      r.existingStatus === "paid" ||
      r.existingStatus === "overdue",
  );
  const commissionRows = rows.filter((r) => r.commissionRate > 0);
  const commissionTotal = rows.reduce((s, r) => s + (r.commissionCents ?? 0), 0);

  return (
    <div className="space-y-5">
      <section className="rounded-[4px] border border-border bg-surface p-4">
        <h2 className="text-[15px] font-semibold">
          Billing run — {periodLabel}
        </h2>
        <p className="mt-1 text-[13px] text-muted">
          Base fees are billed in advance for{" "}
          <span className="font-mono text-foreground">
            {periodStart} → {periodEnd}
          </span>
          . Commission is billed in arrears on{" "}
          <span className="font-medium text-foreground">{salesLabel}</span> gross
          sales. Nothing is issued until you approve it.
        </p>
        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-[13px]">
          <span>
            Tenants: <strong>{rows.length}</strong>
          </span>
          <span>
            Need draft: <strong>{needDrafts.length}</strong>
          </span>
          <span>
            Awaiting approval: <strong>{awaitingApproval.length}</strong>
          </span>
          <span className="text-status-ok">
            Approved: <strong>{approved.length}</strong>
          </span>
          {attention.length > 0 ? (
            <span className="text-status-error">
              Need attention: <strong>{attention.length}</strong>
            </span>
          ) : null}
          <span>
            Issued: <strong>{issued.length}</strong>
          </span>
          <span className="text-accent-strong">
            Commission: <strong>{formatZAR(commissionTotal)}</strong>
          </span>
        </div>
      </section>

      <AttentionPanel rows={attention} salesLabel={salesLabel} />

      <div className="overflow-x-auto">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Tenant</th>
              <th>Plan</th>
              <th className="text-right">Base</th>
              <th className="text-right">Add-ons</th>
              <th className="text-right">{salesLabel} gross</th>
              <th className="text-right">Commission</th>
              <th className="text-right">Total</th>
              <th>Invoice</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const status = invoiceTone(r);
              const total = r.existingTotalCents ?? r.estimatedCents;
              return (
                <tr key={r.tenantId}>
                  <td>
                    <div className="font-medium">{r.tradingName}</div>
                    <div className="font-mono text-[11px] text-muted">
                      {r.slug}
                    </div>
                  </td>
                  <td className="text-[12px]">
                    {r.planName ?? "—"}
                    {r.commissionRate > 0 ? (
                      <div className="text-[10px] text-accent-strong">
                        +{Number((r.commissionRate * 100).toFixed(2))}% commission
                      </div>
                    ) : null}
                  </td>
                  <td className="text-right">
                    <Money cents={r.baseCents} className="text-[12px]" />
                  </td>
                  <td className="text-right text-[12px]">
                    {r.addonCents + r.onceOffCents > 0 ? (
                      <Money cents={r.addonCents + r.onceOffCents} />
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </td>
                  <td className="text-right">
                    <SalesCell row={r} salesLabel={salesLabel} />
                  </td>
                  <td className="text-right">
                    {r.commissionCents === null ? (
                      <span className="text-[11px] text-muted">—</span>
                    ) : (
                      <Money
                        cents={r.commissionCents}
                        className="text-[12px] text-accent-strong"
                      />
                    )}
                  </td>
                  <td className="text-right font-semibold">
                    <Money cents={total} />
                  </td>
                  <td>
                    <StatusPill tone={status.tone} label={status.label} />
                  </td>
                  <td className="text-right">
                    <RowActions row={r} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <section className="rounded-[4px] border border-border bg-surface p-4">
        <h3 className="mb-2 text-[13px] font-semibold">
          1. Read {salesLabel} sales
        </h3>
        <p className="mb-3 text-[12px] text-muted">
          Fetches gross sales from each of the {commissionRows.length} commission
          tenant&apos;s own deployment and rebuilds their drafts. Figures shown in
          the table are cached from the last read, so run this if anything looks
          stale. A tenant that cannot be read is flagged, never zeroed.
        </p>
        <form action={salesAction}>
          <input type="hidden" name="period_start" value={periodStart} />
          <input type="hidden" name="period_end" value={periodEnd} />
          <button
            type="submit"
            disabled={salesPending || commissionRows.length === 0}
            className="h-8 rounded-[4px] border border-border px-3 text-[12px] font-semibold hover:border-primary-light hover:bg-primary hover:text-white disabled:opacity-50"
          >
            {salesPending ? "Reading…" : "Refresh sales figures"}
          </button>
        </form>
        <div className="mt-2">
          <Banner state={salesState} />
        </div>
      </section>

      <section className="rounded-[4px] border border-border bg-surface p-4">
        <h3 className="mb-2 text-[13px] font-semibold">2. Generate drafts</h3>
        <p className="mb-3 text-[12px] text-muted">
          Creates draft invoices for the {needDrafts.length} tenant(s) without one
          for this period. Estimated total{" "}
          {formatZAR(needDrafts.reduce((s, r) => s + r.estimatedCents, 0))}.
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
        <div className="mt-2">
          <Banner state={genState} />
        </div>
      </section>

      <section className="rounded-[4px] border border-border bg-surface p-4">
        <h3 className="mb-2 text-[13px] font-semibold">3. Approve</h3>
        <p className="mb-3 text-[12px] text-muted">
          Marks reviewed drafts as cleared for issuing. Approve individually in
          the table above, or all {awaitingApproval.length} clean draft(s) at
          once. Flagged drafts are always skipped.
        </p>
        <form action={approveAction}>
          <input type="hidden" name="period_start" value={periodStart} />
          <input type="hidden" name="period_end" value={periodEnd} />
          <button
            type="submit"
            disabled={approvePending || awaitingApproval.length === 0}
            className="h-8 rounded-[4px] bg-accent-strong px-3 text-[12px] font-semibold text-white disabled:opacity-50"
          >
            {approvePending
              ? "Approving…"
              : `Approve ${awaitingApproval.length} draft(s)`}
          </button>
        </form>
        <div className="mt-2">
          <Banner state={approveState} />
        </div>
      </section>

      <section className="rounded-[4px] border border-border bg-surface p-4">
        <h3 className="mb-2 text-[13px] font-semibold">4. Issue approved</h3>
        <p className="mb-3 text-[12px] text-muted">
          Allocates gap-free invoice numbers, writes PDFs once, and emails
          billing contacts. Only the {approved.length} approved draft(s) proceed.{" "}
          <strong>Never auto-issues</strong> — confirm explicitly.
        </p>
        <form action={issueAction} className="space-y-3">
          <input type="hidden" name="period_start" value={periodStart} />
          <input type="hidden" name="period_end" value={periodEnd} />
          <label className="flex items-start gap-2 text-[12px]">
            <input type="checkbox" name="confirm_issue" className="mt-0.5" required />
            <span>
              I have reviewed the {approved.length} approved draft(s) and confirm
              issuing them for {periodLabel}. This cannot be undone (corrections
              via credit note).
            </span>
          </label>
          <button
            type="submit"
            disabled={issuePending || approved.length === 0}
            className="h-8 rounded-[4px] border border-status-error px-3 text-[12px] font-semibold text-status-error hover:bg-status-error hover:text-white disabled:opacity-50"
          >
            {issuePending ? "Issuing…" : `Issue ${approved.length} invoice(s)`}
          </button>
        </form>
        <div className="mt-2">
          <Banner state={issueState} />
        </div>
      </section>
    </div>
  );
}
