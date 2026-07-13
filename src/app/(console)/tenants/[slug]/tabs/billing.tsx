"use client";

import { useActionState, useTransition } from "react";
import {
  addAddonAction,
  removeAddonAction,
  type ActionState,
} from "@/app/(console)/tenants/actions";
import { Money, StatusPill } from "@/components/ui/status";
import { formatIsoDate } from "@/lib/billing/cycle";
import type { StatusTone } from "@/components/ui/status";
import type {
  AddonRecord,
  InvoiceSummary,
  PaymentSummary,
  SubscriptionRecord,
  TenantStatus,
} from "@/lib/tenants/types";

const empty: ActionState = {};

export function BillingTab({
  slug,
  status,
  subscriptions,
  addons,
  invoices,
  payments,
  outstandingCents,
  invoiceStatusLabel,
  invoiceStatusTone,
}: {
  slug: string;
  status: TenantStatus;
  subscriptions: SubscriptionRecord[];
  addons: AddonRecord[];
  invoices: InvoiceSummary[];
  payments: PaymentSummary[];
  outstandingCents: number;
  invoiceStatusLabel: (s: string | null) => string;
  invoiceStatusTone: (s: string | null) => StatusTone;
}) {
  const [addonState, addonFormAction, addonPending] = useActionState(
    addAddonAction,
    empty,
  );
  const [pending, startTransition] = useTransition();
  const canEdit = status !== "offboarded";

  return (
    <div className="space-y-5">
      <section className="rounded-[4px] border border-border bg-surface p-4">
        <div className="mb-2 flex items-baseline justify-between">
          <h3 className="text-[12px] font-semibold tracking-wide text-muted uppercase">
            Outstanding
          </h3>
          <Money
            cents={outstandingCents}
            className="text-[16px] font-semibold text-accent-strong"
          />
        </div>
      </section>

      <section className="rounded-[4px] border border-border bg-surface p-4">
        <h3 className="mb-3 text-[12px] font-semibold tracking-wide text-muted uppercase">
          Subscriptions
        </h3>
        <table className="admin-table">
          <thead>
            <tr>
              <th>Plan</th>
              <th>Status</th>
              <th>Started</th>
              <th>Ends</th>
              <th className="text-right">Monthly</th>
            </tr>
          </thead>
          <tbody>
            {subscriptions.map((s) => (
              <tr key={s.id}>
                <td>{s.plan_name}</td>
                <td>
                  <StatusPill
                    tone={s.status === "active" ? "ok" : "idle"}
                    label={s.status === "active" ? "Active" : "Cancelled"}
                  />
                </td>
                <td className="font-mono text-[12px]">
                  {formatIsoDate(s.started_on)}
                </td>
                <td className="font-mono text-[12px]">
                  {formatIsoDate(s.ends_on)}
                </td>
                <td className="text-right">
                  <Money cents={s.current_monthly_cents} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="rounded-[4px] border border-border bg-surface p-4">
        <h3 className="mb-3 text-[12px] font-semibold tracking-wide text-muted uppercase">
          Addons
        </h3>
        <table className="admin-table mb-3">
          <thead>
            <tr>
              <th>Description</th>
              <th>Kind</th>
              <th>From</th>
              <th>Until</th>
              <th className="text-right">Amount</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {addons.length === 0 ? (
              <tr>
                <td colSpan={6} className="text-muted">
                  No addons
                </td>
              </tr>
            ) : (
              addons.map((a) => (
                <tr key={a.id}>
                  <td>{a.description}</td>
                  <td className="font-mono text-[12px]">{a.kind}</td>
                  <td className="font-mono text-[12px]">
                    {formatIsoDate(a.active_from)}
                  </td>
                  <td className="font-mono text-[12px]">
                    {formatIsoDate(a.active_until)}
                  </td>
                  <td className="text-right">
                    <Money cents={a.amount_cents} />
                  </td>
                  <td>
                    {canEdit && !a.active_until ? (
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() =>
                          startTransition(async () => {
                            await removeAddonAction(slug, a.id);
                          })
                        }
                        className="text-[12px] text-status-error hover:underline"
                      >
                        Remove
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>

        {canEdit ? (
          <form action={addonFormAction} className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="slug" value={slug} />
            <label className="flex flex-col gap-1">
              <span className="text-[11px] text-muted uppercase">Description</span>
              <input
                name="description"
                required
                className="h-8 rounded-[4px] border border-border px-2 text-[13px]"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] text-muted uppercase">Kind</span>
              <select
                name="kind"
                className="h-8 rounded-[4px] border border-border px-2 text-[13px]"
                defaultValue="recurring"
              >
                <option value="recurring">Recurring (next cycle)</option>
                <option value="once_off">Once-off (next invoice)</option>
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] text-muted uppercase">Amount</span>
              <input
                name="amount"
                required
                placeholder="500"
                className="h-8 w-28 rounded-[4px] border border-border px-2 font-mono text-[13px] tabular-nums"
              />
            </label>
            <button
              type="submit"
              disabled={addonPending}
              className="h-8 rounded-[4px] bg-accent-strong px-3 text-[12px] font-semibold text-white disabled:opacity-60"
            >
              Add addon
            </button>
            {addonState.error ? (
              <span className="text-[12px] text-status-error">
                {addonState.error}
              </span>
            ) : null}
            {addonState.message ? (
              <span className="text-[12px] text-status-ok">
                {addonState.message}
              </span>
            ) : null}
          </form>
        ) : null}
        <p className="mt-2 text-[11px] text-muted">
          Recurring addons follow the next-cycle rule. Once-off addons apply to
          the next invoice generated.
        </p>
      </section>

      <section className="rounded-[4px] border border-border bg-surface p-4">
        <h3 className="mb-3 text-[12px] font-semibold tracking-wide text-muted uppercase">
          Invoices
        </h3>
        <table className="admin-table">
          <thead>
            <tr>
              <th>Number</th>
              <th>Status</th>
              <th>Period</th>
              <th className="text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {invoices.length === 0 ? (
              <tr>
                <td colSpan={4} className="text-muted">
                  No invoices yet
                </td>
              </tr>
            ) : (
              invoices.map((inv) => (
                <tr key={inv.id}>
                  <td className="font-mono text-[12px]">
                    {inv.invoice_number ?? "—"}
                  </td>
                  <td>
                    <StatusPill
                      tone={invoiceStatusTone(inv.status)}
                      label={invoiceStatusLabel(inv.status)}
                    />
                  </td>
                  <td className="font-mono text-[12px]">
                    {formatIsoDate(inv.period_start)} →{" "}
                    {formatIsoDate(inv.period_end)}
                  </td>
                  <td className="text-right">
                    <Money cents={inv.total_cents} />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </section>

      <section className="rounded-[4px] border border-border bg-surface p-4">
        <h3 className="mb-3 text-[12px] font-semibold tracking-wide text-muted uppercase">
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
            {payments.length === 0 ? (
              <tr>
                <td colSpan={4} className="text-muted">
                  No payments yet
                </td>
              </tr>
            ) : (
              payments.map((p) => (
                <tr key={p.id}>
                  <td className="font-mono text-[12px]">
                    {formatIsoDate(p.received_on)}
                  </td>
                  <td>{p.method}</td>
                  <td className="font-mono text-[12px]">{p.reference ?? "—"}</td>
                  <td className="text-right">
                    <Money cents={p.amount_cents} />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}
