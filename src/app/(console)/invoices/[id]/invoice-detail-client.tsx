"use client";

import Link from "next/link";
import { useActionState, useState, useTransition } from "react";
import {
  approveOneAction,
  creditNoteAction,
  deleteDraftAction,
  issueOneAction,
  markOverdueAction,
  markPaidAction,
  resendInvoiceEmailAction,
  unapproveOneAction,
  voidAction,
  type ActionState,
} from "@/app/(console)/billing/actions";
import {
  recordPaymentAction,
  type PaymentActionState,
} from "@/app/(console)/payments/actions";
import { Money, StatusPill } from "@/components/ui/status";
import { formatIsoDate, sastToday } from "@/lib/billing/cycle";
import type { InvoiceDetail } from "@/lib/invoices/queries";
import {
  invoiceStatusLabel,
  invoiceStatusTone,
} from "@/lib/tenants/status";
import { ManualDraftEditor } from "./manual-draft-editor";

const empty: ActionState = {};
const payEmpty: PaymentActionState = {};

const btnBase =
  "inline-flex h-8 items-center justify-center rounded-[4px] px-3 text-[12px] font-semibold transition-colors disabled:pointer-events-none disabled:opacity-50";
const btnPrimary = `${btnBase} bg-accent-strong text-white hover:bg-primary hover:text-white`;
const btnNeutral = `${btnBase} border border-border bg-surface text-foreground hover:border-primary-light hover:bg-primary hover:text-white`;
const btnWarn = `${btnBase} border border-status-warn bg-surface text-status-warn hover:bg-status-warn hover:text-white`;
const btnDanger = `${btnBase} border border-status-error bg-surface text-status-error hover:bg-status-error hover:text-white`;

export function InvoiceDetailClient({
  invoice,
  vatRegistered,
}: {
  invoice: InvoiceDetail;
  vatRegistered: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<ActionState>({});
  const [cnState, cnAction, cnPending] = useActionState(creditNoteAction, empty);
  const [payState, payAction, payPending] = useActionState(
    recordPaymentAction,
    payEmpty,
  );

  function run(fn: () => Promise<ActionState>) {
    startTransition(async () => {
      const r = await fn();
      setMsg(r.error ? { error: r.error } : { message: r.message });
    });
  }

  const isDraft = invoice.status === "draft";
  const approved = Boolean(invoice.approved_at);

  return (
    <div className="space-y-5">
      {isDraft && invoice.needs_attention ? (
        <div className="rounded-[4px] border-2 border-status-warn bg-status-warn/10 px-3 py-2 text-[13px] text-status-warn">
          <strong>NEEDS ATTENTION</strong> —{" "}
          {invoice.attention_reason ?? "this draft is incomplete"}. It cannot be
          approved or issued until the figure is resolved. Fix it on the{" "}
          <Link href="/billing/run" className="underline">
            billing run
          </Link>{" "}
          screen, where you can enter the sales figure by hand or waive the
          commission on the record.
        </div>
      ) : null}

      {isDraft && !invoice.needs_attention ? (
        approved ? (
          <div className="flex flex-wrap items-center gap-2 rounded-[4px] border border-status-ok bg-status-ok/10 px-3 py-2 text-[13px] text-status-ok">
            <span>
              <strong>Approved</strong>
              {invoice.approved_by ? ` by ${invoice.approved_by}` : ""} — cleared
              to issue.
            </span>
            <button
              type="button"
              className="underline"
              disabled={pending}
              onClick={() => run(() => unapproveOneAction(invoice.id))}
            >
              Withdraw approval
            </button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-3 rounded-[4px] border border-border bg-surface px-3 py-2 text-[13px]">
            <span className="text-muted">
              This draft has not been approved yet. Nothing is emailed or charged
              until it is.
            </span>
            <button
              type="button"
              className={btnPrimary}
              disabled={pending}
              onClick={() => run(() => approveOneAction(invoice.id))}
            >
              Approve
            </button>
          </div>
        )
      ) : null}

      {invoice.unsent ? (
        <div className="rounded-[4px] border-2 border-status-error bg-status-error/10 px-3 py-2 text-[13px] text-status-error">
          <strong>UNSENT</strong> — this invoice is issued but was never emailed
          to the billing contact.{" "}
          <button
            type="button"
            className="underline"
            disabled={pending}
            onClick={() => run(() => resendInvoiceEmailAction(invoice.id))}
          >
            Resend now
          </button>
        </div>
      ) : null}

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-mono text-[18px] font-semibold">
              {invoice.invoice_number ?? `Draft #${invoice.id}`}
            </h2>
            <StatusPill
              tone={invoiceStatusTone(invoice.status)}
              label={invoiceStatusLabel(invoice.status)}
            />
            {invoice.source === "manual" ? (
              <StatusPill tone="idle" label="Custom" />
            ) : null}
            {invoice.sent_at ? (
              <StatusPill tone="ok" label="Sent" />
            ) : invoice.status !== "draft" ? (
              <StatusPill tone="error" label="Unsent" />
            ) : null}
          </div>
          <p className="mt-1 text-[13px] text-muted">
            <Link
              href={`/tenants/${invoice.slug}`}
              className="hover:text-accent-strong"
            >
              {invoice.trading_name}
            </Link>
            {" · "}
            {formatIsoDate(invoice.period_start)} →{" "}
            {formatIsoDate(invoice.period_end)}
          </p>
        </div>
        <Link href="/invoices" className="text-[13px] text-muted">
          ← Invoices
        </Link>
      </div>

      <div className="flex flex-wrap gap-2">
        {invoice.status === "draft" ? (
          <>
            <button
              type="button"
              disabled={pending || !approved || invoice.needs_attention}
              onClick={() => run(() => issueOneAction(invoice.id))}
              className={btnPrimary}
              title={
                approved
                  ? undefined
                  : "Approve the draft first — issuing is final"
              }
            >
              Issue &amp; email
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => run(() => deleteDraftAction(invoice.id))}
              className={btnDanger}
            >
              Delete draft
            </button>
          </>
        ) : null}
        {invoice.status === "issued" || invoice.status === "overdue" ? (
          <>
            <button
              type="button"
              disabled={pending}
              onClick={() => run(() => markPaidAction(invoice.id))}
              className={btnPrimary}
            >
              Mark paid
            </button>
            {invoice.status === "issued" ? (
              <button
                type="button"
                disabled={pending}
                onClick={() => run(() => markOverdueAction(invoice.id))}
                className={btnWarn}
              >
                Mark overdue
              </button>
            ) : null}
            <button
              type="button"
              disabled={pending}
              onClick={() => run(() => voidAction(invoice.id))}
              className={btnDanger}
            >
              Void
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => run(() => resendInvoiceEmailAction(invoice.id))}
              className={btnNeutral}
            >
              Email PDF
            </button>
          </>
        ) : null}
        {invoice.pdf_path ? (
          <a
            href={`/invoices/${invoice.id}/pdf`}
            target="_blank"
            rel="noopener noreferrer"
            className={btnNeutral}
          >
            View PDF
          </a>
        ) : invoice.status === "draft" ? (
          <span className="inline-flex h-8 items-center text-[12px] text-muted">
            PDF available after issue
          </span>
        ) : null}
      </div>

      {msg.error ? (
        <p className="text-[12px] text-status-error">{msg.error}</p>
      ) : null}
      {msg.message ? (
        <p className="text-[12px] text-status-ok">{msg.message}</p>
      ) : null}

      {invoice.status === "draft" && invoice.source === "manual" ? (
        <ManualDraftEditor invoice={invoice} />
      ) : null}

      {invoice.pdf_path ? (
        <section className="overflow-hidden rounded-[4px] border border-border bg-surface">
          <div className="flex items-center justify-between border-b border-border px-3 py-2">
            <h3 className="text-[12px] font-semibold tracking-wide text-muted uppercase">
              PDF
            </h3>
            <a
              href={`/invoices/${invoice.id}/pdf`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[12px] text-accent-strong hover:underline"
            >
              Open in new tab
            </a>
          </div>
          <iframe
            title={`Invoice ${invoice.invoice_number ?? invoice.id} PDF`}
            src={`/invoices/${invoice.id}/pdf`}
            className="h-[min(70vh,720px)] w-full bg-white"
          />
        </section>
      ) : null}

      {invoice.status === "draft" && invoice.source === "manual" ? null : (
        <table className="admin-table">
          <thead>
            <tr>
              <th>Description</th>
              <th className="text-right">Qty</th>
              <th className="text-right">Unit</th>
              <th className="text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {invoice.lines.map((l) => (
              <tr key={l.id}>
                <td>{l.description}</td>
                <td className="text-right font-mono text-[12px]">{l.quantity}</td>
                <td className="text-right">
                  <Money cents={l.unit_cents} />
                </td>
                <td className="text-right">
                  <Money cents={l.line_total_cents} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {invoice.commission_cents !== null &&
      invoice.commission_basis_cents !== null ? (
        <p className="text-[12px] text-muted">
          Commission is{" "}
          {Number(((invoice.commission_rate ?? 0) * 100).toFixed(2))}% of gross
          sales for the period, before refunds. Basis:{" "}
          <Money
            cents={invoice.commission_basis_cents}
            className="text-foreground"
          />{" "}
          measured{" "}
          {invoice.sales_period_start
            ? `${formatIsoDate(invoice.sales_period_start)} → ${formatIsoDate(invoice.sales_period_end ?? invoice.sales_period_start)}`
            : "for the sales month"}
          {invoice.sales_source ? `, read from ${invoice.sales_source}` : ""}.
        </p>
      ) : null}

      <dl className="ml-auto grid max-w-xs grid-cols-[1fr_auto] gap-x-6 gap-y-1 text-[13px]">
        <dt className="text-muted">Subtotal</dt>
        <dd className="text-right">
          <Money cents={invoice.subtotal_cents} />
        </dd>
        {vatRegistered ? (
          <>
            <dt className="text-muted">VAT</dt>
            <dd className="text-right">
              <Money cents={invoice.vat_cents} />
            </dd>
          </>
        ) : null}
        <dt className="font-semibold">Total</dt>
        <dd className="text-right font-semibold text-accent-strong">
          <Money cents={invoice.total_cents} />
        </dd>
        <dt className="text-muted">Paid</dt>
        <dd className="text-right">
          <Money cents={invoice.paid_cents} />
        </dd>
        <dt className="font-semibold">Outstanding</dt>
        <dd className="text-right font-semibold text-status-warn">
          <Money cents={invoice.outstanding_cents} />
        </dd>
        <dt className="text-muted">Due</dt>
        <dd className="text-right font-mono text-[12px]">
          {formatIsoDate(invoice.due_date)}
        </dd>
      </dl>

      {(invoice.status === "issued" || invoice.status === "overdue") && (
        <section className="rounded-[4px] border border-border bg-surface p-4">
          <h3 className="mb-2 text-[13px] font-semibold">Record payment</h3>
          <form action={payAction} className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="tenant_id" value={invoice.tenant_id} />
            <input type="hidden" name="invoice_id" value={invoice.id} />
            <label className="flex flex-col gap-1 text-[11px]">
              <span className="text-muted uppercase">Amount</span>
              <input
                name="amount"
                required
                className="h-8 w-28 rounded-[4px] border border-border px-2 font-mono text-[13px] tabular-nums"
              />
            </label>
            <label className="flex flex-col gap-1 text-[11px]">
              <span className="text-muted uppercase">Method</span>
              <select
                name="method"
                defaultValue="eft"
                className="h-8 rounded-[4px] border border-border px-2 text-[13px]"
              >
                <option value="eft">EFT</option>
                <option value="payfast">PayFast</option>
                <option value="debit_order">Debit order</option>
                <option value="other">Other</option>
              </select>
            </label>
            <label className="flex flex-col gap-1 text-[11px]">
              <span className="text-muted uppercase">Date</span>
              <input
                name="received_on"
                type="date"
                required
                defaultValue={sastToday()}
                className="h-8 rounded-[4px] border border-border px-2 font-mono text-[12px]"
              />
            </label>
            <label className="flex flex-col gap-1 text-[11px]">
              <span className="text-muted uppercase">Reference</span>
              <input
                name="reference"
                defaultValue={invoice.invoice_number ?? ""}
                className="h-8 w-40 rounded-[4px] border border-border px-2 font-mono text-[12px]"
              />
            </label>
            <button
              type="submit"
              disabled={payPending}
              className={btnPrimary}
            >
              Save payment
            </button>
          </form>
          {payState.error ? (
            <p className="mt-2 text-[12px] text-status-error">{payState.error}</p>
          ) : null}
          {payState.message ? (
            <p className="mt-2 text-[12px] text-status-ok">{payState.message}</p>
          ) : null}
        </section>
      )}

      {invoice.payments.length > 0 ? (
        <section>
          <h3 className="mb-2 text-[12px] font-semibold uppercase text-muted">
            Payments
          </h3>
          <table className="admin-table">
            <thead>
              <tr>
                <th>Received</th>
                <th>Method</th>
                <th>Reference</th>
                <th className="text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {invoice.payments.map((p) => (
                <tr key={p.id}>
                  <td className="font-mono text-[12px]">{p.received_on}</td>
                  <td>{p.method}</td>
                  <td className="font-mono text-[11px]">{p.reference ?? "—"}</td>
                  <td className="text-right">
                    <Money cents={p.amount_cents} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}

      {(invoice.status === "issued" ||
        invoice.status === "paid" ||
        invoice.status === "overdue") && (
        <section className="rounded-[4px] border border-border bg-surface p-4">
          <h3 className="mb-2 text-[13px] font-semibold">
            Correct with credit note
          </h3>
          <form action={cnAction} className="space-y-2">
            <input type="hidden" name="invoice_id" value={invoice.id} />
            <textarea
              name="reason"
              required
              rows={2}
              placeholder="Reason for correction"
              className="w-full rounded-[4px] border border-border px-2 py-1.5 text-[13px]"
            />
            <label className="flex items-center gap-2 text-[12px]">
              <input type="checkbox" name="replacement" defaultChecked />
              Generate replacement draft for the same period
            </label>
            <button
              type="submit"
              disabled={cnPending}
              className={btnDanger}
            >
              Issue credit note
            </button>
          </form>
          {cnState.error ? (
            <p className="mt-2 text-[12px] text-status-error">{cnState.error}</p>
          ) : null}
          {cnState.message ? (
            <p className="mt-2 text-[12px] text-status-ok">{cnState.message}</p>
          ) : null}
        </section>
      )}

      {invoice.credit_notes.length > 0 ? (
        <section>
          <h3 className="mb-2 text-[12px] font-semibold uppercase text-muted">
            Credit notes
          </h3>
          <table className="admin-table">
            <thead>
              <tr>
                <th>Number</th>
                <th>Reason</th>
                <th className="text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {invoice.credit_notes.map((cn) => (
                <tr key={cn.id}>
                  <td className="font-mono text-[12px]">
                    {cn.credit_note_number}
                  </td>
                  <td>{cn.reason}</td>
                  <td className="text-right">
                    <Money cents={cn.total_cents} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}
    </div>
  );
}
