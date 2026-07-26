"use client";

import { useActionState } from "react";
import {
  confirmBankMatchAction,
  ignoreBankTxAction,
  setBankInvoiceAction,
  unallocatedBankTxAction,
  type PaymentActionState,
} from "@/app/(console)/payments/actions";
import { Money, StatusPill } from "@/components/ui/status";
import type { BankTxRow } from "@/lib/payments/reconcile";

const empty: PaymentActionState = {};

export function ReconcileClient({
  credits,
  invoices,
  gap,
}: {
  credits: BankTxRow[];
  invoices: {
    id: number;
    invoice_number: string;
    trading_name: string;
    outstanding_cents: number;
  }[];
  gap: {
    latestPeriodEnd: string | null;
    gapDays: number | null;
    warn: boolean;
  } | null;
}) {
  return (
    <div className="space-y-4">
      {gap?.warn ? (
        <div className="rounded-[4px] border border-status-warn bg-status-warn/10 p-3 text-[13px] text-status-warn">
          {gap.latestPeriodEnd
            ? `Statement import gap: latest imported period ended ${gap.latestPeriodEnd} (${gap.gapDays} days ago). FNB only keeps ~2–3 months of OFX — import monthly.`
            : "No statements imported yet. Upload an FNB OFX from Payments."}
        </div>
      ) : null}

      {credits.length === 0 ? (
        <p className="text-[13px] text-muted">No unmatched credits.</p>
      ) : (
        <ul className="space-y-3">
          {credits.map((tx) => (
            <CreditRow key={tx.id} tx={tx} invoices={invoices} />
          ))}
        </ul>
      )}
    </div>
  );
}

function CreditRow({
  tx,
  invoices,
}: {
  tx: BankTxRow;
  invoices: {
    id: number;
    invoice_number: string;
    trading_name: string;
    outstanding_cents: number;
  }[];
}) {
  const [confirmState, confirmAction, confirmPending] = useActionState(
    confirmBankMatchAction,
    empty,
  );
  const [ignoreState, ignoreAction, ignorePending] = useActionState(
    ignoreBankTxAction,
    empty,
  );
  const [setState, setAction, setPending] = useActionState(
    setBankInvoiceAction,
    empty,
  );
  const [unallocState, unallocAction, unallocPending] = useActionState(
    unallocatedBankTxAction,
    empty,
  );

  const tone =
    tx.proposed_confidence === "high"
      ? "ok"
      : tx.proposed_confidence === "medium"
        ? "warn"
        : tx.proposed_confidence === "low"
          ? "idle"
          : "idle";

  return (
    <li className="rounded-[4px] border border-border bg-surface p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="font-mono text-[12px] text-muted">
            {tx.posted_on} · {tx.fitid}
          </div>
          <div className="mt-1 text-[14px] font-medium">{tx.description}</div>
          {tx.reference ? (
            <div className="font-mono text-[12px] text-muted">{tx.reference}</div>
          ) : null}
        </div>
        <Money
          cents={tx.amount_cents}
          className="text-[15px] font-semibold text-accent-strong"
        />
      </div>

      <div className="mt-3 space-y-2 border-t border-border pt-3">
        {tx.proposed_invoice_id ? (
          <div className="flex flex-wrap items-center gap-2 text-[13px]">
            <StatusPill
              tone={tone}
              label={tx.proposed_confidence ?? "proposed"}
            />
            <span>
              → {tx.proposed_invoice_number} ({tx.proposed_tenant})
            </span>
            <p className="basis-full text-[12px] text-muted">
              {tx.proposed_reason}
            </p>
          </div>
        ) : (
          <p className="text-[12px] text-muted">No automatic proposal</p>
        )}

        <div className="flex flex-wrap items-end gap-2">
          {tx.proposed_invoice_id ? (
            <form action={confirmAction}>
              <input type="hidden" name="transaction_id" value={tx.id} />
              <input
                type="hidden"
                name="invoice_id"
                value={tx.proposed_invoice_id}
              />
              <button
                type="submit"
                disabled={confirmPending}
                className="h-8 rounded-[4px] bg-accent-strong px-3 text-[12px] font-semibold text-white disabled:opacity-60"
              >
                Confirm
              </button>
            </form>
          ) : null}

          <form action={setAction} className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="transaction_id" value={tx.id} />
            <label className="flex flex-col gap-1">
              <span className="text-[10px] text-muted uppercase">
                Match to invoice
              </span>
              <select
                name="invoice_id"
                required
                defaultValue={tx.proposed_invoice_id ?? ""}
                className="h-8 max-w-xs rounded-[4px] border border-border px-2 font-mono text-[12px]"
              >
                <option value="" disabled>
                  Select…
                </option>
                {invoices.map((inv) => (
                  <option key={inv.id} value={inv.id}>
                    {inv.invoice_number} · {inv.trading_name} ·{" "}
                    {(inv.outstanding_cents / 100).toFixed(2)}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="submit"
              disabled={setPending}
              className="h-8 rounded-[4px] border border-border px-3 text-[12px] font-semibold hover:border-primary-light hover:bg-primary hover:text-white disabled:opacity-60"
            >
              Set proposal
            </button>
          </form>

          <form action={unallocAction}>
            <input type="hidden" name="transaction_id" value={tx.id} />
            <button
              type="submit"
              disabled={unallocPending || !tx.proposed_invoice_id}
              className="h-8 rounded-[4px] border border-border px-3 text-[12px] disabled:opacity-40"
              title={
                tx.proposed_invoice_id
                  ? undefined
                  : "Select an invoice first (needed for tenant)"
              }
            >
              Record unallocated
            </button>
          </form>

          <form action={ignoreAction} className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="transaction_id" value={tx.id} />
            <input
              name="reason"
              required
              placeholder="Ignore reason (fee, interest…)"
              className="h-8 w-52 rounded-[4px] border border-border px-2 text-[12px]"
            />
            <button
              type="submit"
              disabled={ignorePending}
              className="h-8 rounded-[4px] border border-border px-3 text-[12px] text-muted disabled:opacity-60"
            >
              Ignore
            </button>
          </form>
        </div>

        {[confirmState, ignoreState, setState, unallocState].map((s, i) =>
          s.error ? (
            <p key={`e${i}`} className="text-[12px] text-status-error">
              {s.error}
            </p>
          ) : s.message ? (
            <p key={`m${i}`} className="text-[12px] text-status-ok">
              {s.message}
            </p>
          ) : null,
        )}
      </div>
    </li>
  );
}
