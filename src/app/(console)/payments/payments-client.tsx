"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import {
  recordPaymentAction,
  type PaymentActionState,
} from "@/app/(console)/payments/actions";
import { Money } from "@/components/ui/status";
import { sastToday } from "@/lib/billing/cycle";
import type { PaymentListRow } from "@/lib/payments/service";

const empty: PaymentActionState = {};

export function PaymentsClient({
  payments,
  tenants,
}: {
  payments: PaymentListRow[];
  tenants: { id: number; slug: string; trading_name: string }[];
}) {
  const [state, formAction, pending] = useActionState(
    recordPaymentAction,
    empty,
  );
  const [tenantId, setTenantId] = useState("");

  return (
    <div className="space-y-5">
      <section className="rounded-[4px] border border-border bg-surface p-4">
        <h2 className="mb-3 text-[13px] font-semibold">Record payment</h2>
        <form action={formAction} className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-[12px]">
            <span className="text-muted uppercase">Tenant</span>
            <select
              name="tenant_id"
              required
              value={tenantId}
              onChange={(e) => setTenantId(e.target.value)}
              className="h-8 rounded-[4px] border border-border px-2 text-[13px]"
            >
              <option value="">Select…</option>
              {tenants.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.trading_name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-[12px]">
            <span className="text-muted uppercase">Invoice</span>
            <select
              name="invoice_id"
              className="h-8 min-w-[10rem] rounded-[4px] border border-border px-2 font-mono text-[12px]"
              defaultValue="unallocated"
            >
              <option value="unallocated">Unallocated</option>
            </select>
            <span className="text-[10px] text-muted">
              Leave unallocated to assign later. Or open the invoice page to
              allocate directly.
            </span>
          </label>
          <label className="flex flex-col gap-1 text-[12px]">
            <span className="text-muted uppercase">Amount</span>
            <input
              name="amount"
              required
              placeholder="1500"
              className="h-8 w-28 rounded-[4px] border border-border px-2 font-mono text-[13px] tabular-nums"
            />
          </label>
          <label className="flex flex-col gap-1 text-[12px]">
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
          <label className="flex flex-col gap-1 text-[12px]">
            <span className="text-muted uppercase">Received</span>
            <input
              name="received_on"
              type="date"
              required
              defaultValue={sastToday()}
              className="h-8 rounded-[4px] border border-border px-2 font-mono text-[12px]"
            />
          </label>
          <label className="flex flex-col gap-1 text-[12px]">
            <span className="text-muted uppercase">Reference</span>
            <input
              name="reference"
              className="h-8 w-40 rounded-[4px] border border-border px-2 font-mono text-[12px]"
            />
          </label>
          <button
            type="submit"
            disabled={pending}
            className="h-8 rounded-[4px] bg-accent-strong px-3 text-[12px] font-semibold text-white disabled:opacity-60"
          >
            Save
          </button>
        </form>
        {state.error ? (
          <p className="mt-2 text-[12px] text-status-error">{state.error}</p>
        ) : null}
        {state.message ? (
          <p className="mt-2 text-[12px] text-status-ok">{state.message}</p>
        ) : null}
      </section>

      <section className="rounded-[4px] border border-dashed border-border bg-surface/50 p-4">
        <h2 className="mb-1 text-[13px] font-semibold text-muted">
          Bank statement CSV import
        </h2>
        <p className="text-[12px] text-muted">
          Stubbed for later — fuzzy matching on reference against open invoices.
          Interface lives in{" "}
          <code className="font-mono text-[11px]">
            lib/payments/bank-import.ts
          </code>
          .
        </p>
        <button
          type="button"
          disabled
          className="mt-2 h-8 cursor-not-allowed rounded-[4px] border border-border px-3 text-[12px] text-muted opacity-60"
        >
          Import CSV (coming later)
        </button>
      </section>

      <table className="admin-table">
        <thead>
          <tr>
            <th>Received</th>
            <th>Tenant</th>
            <th>Invoice</th>
            <th>Method</th>
            <th>Reference</th>
            <th className="text-right">Amount</th>
          </tr>
        </thead>
        <tbody>
          {payments.length === 0 ? (
            <tr>
              <td colSpan={6} className="text-muted">
                No payments yet.
              </td>
            </tr>
          ) : (
            payments.map((p) => (
              <tr key={p.id}>
                <td className="font-mono text-[12px]">{p.received_on}</td>
                <td>
                  <Link
                    href={`/tenants/${p.slug}`}
                    className="hover:text-accent-strong"
                  >
                    {p.trading_name}
                  </Link>
                </td>
                <td className="font-mono text-[12px]">
                  {p.invoice_id && p.invoice_number ? (
                    <Link
                      href={`/invoices/${p.invoice_id}`}
                      className="text-accent-strong"
                    >
                      {p.invoice_number}
                    </Link>
                  ) : (
                    <span className="text-status-warn">Unallocated</span>
                  )}
                </td>
                <td>{p.method}</td>
                <td className="font-mono text-[11px]">{p.reference ?? "—"}</td>
                <td className="text-right">
                  <Money cents={p.amount_cents} />
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
