"use client";

import Link from "next/link";
import { useActionState, useTransition } from "react";
import {
  addAddonAction,
  adjustSubscriptionPriceAction,
  removeAddonAction,
  setBillingDayAction,
  setTenantPackageAction,
  type ActionState,
} from "@/app/(console)/tenants/actions";
import { Money, StatusPill } from "@/components/ui/status";
import { formatIsoDate } from "@/lib/billing/cycle";
import { formatZAR } from "@/lib/money";
import {
  invoiceStatusLabel,
  invoiceStatusTone,
} from "@/lib/tenants/status";
import type {
  AddonRecord,
  InvoiceSummary,
  PaymentSummary,
  PlanRow,
  SubscriptionRecord,
  TenantStatus,
} from "@/lib/tenants/types";

const empty: ActionState = {};

function centsToInput(cents: number): string {
  const rand = Math.trunc(cents / 100);
  const frac = Math.abs(cents % 100);
  if (frac === 0) return String(rand);
  return `${rand}.${String(frac).padStart(2, "0")}`;
}

export function BillingTab({
  slug,
  status,
  subscriptions,
  addons,
  invoices,
  payments,
  outstandingCents,
  catalogMonthlyCents,
  billingDay,
  plans,
}: {
  slug: string;
  status: TenantStatus;
  subscriptions: SubscriptionRecord[];
  addons: AddonRecord[];
  invoices: InvoiceSummary[];
  payments: PaymentSummary[];
  outstandingCents: number;
  catalogMonthlyCents: number | null;
  billingDay: number;
  plans: PlanRow[];
}) {
  const [addonState, addonFormAction, addonPending] = useActionState(
    addAddonAction,
    empty,
  );
  const [priceState, priceFormAction, pricePending] = useActionState(
    adjustSubscriptionPriceAction,
    empty,
  );
  const [packageState, packageFormAction, packagePending] = useActionState(
    setTenantPackageAction,
    empty,
  );
  const [termsState, termsFormAction, termsPending] = useActionState(
    setBillingDayAction,
    empty,
  );
  const [pending, startTransition] = useTransition();
  const canEdit = status !== "offboarded";
  const canBill = status === "active" || status === "suspended";

  const activeSub = subscriptions.find((s) => s.status === "active");
  const billedCents = activeSub?.current_monthly_cents ?? null;
  const hasDiscount =
    billedCents !== null &&
    catalogMonthlyCents !== null &&
    billedCents !== catalogMonthlyCents;

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
          Package
        </h3>
        {activeSub ? (
          <div className="mb-3 space-y-1 text-[13px]">
            <p>
              <span className="text-muted">Current:</span> {activeSub.plan_name}{" "}
              ·{" "}
              <Money
                cents={activeSub.current_monthly_cents}
                className="font-semibold text-accent-strong"
              />
              /mo
              {hasDiscount && catalogMonthlyCents !== null ? (
                <span className="ml-2 text-[12px] text-status-warn">
                  (catalog {formatZAR(catalogMonthlyCents)})
                </span>
              ) : null}
            </p>
          </div>
        ) : (
          <p className="mb-3 text-[13px] text-muted">No active subscription</p>
        )}

        {canEdit && activeSub ? (
          <form
            action={packageFormAction}
            className="mb-4 flex flex-wrap items-end gap-2 border-b border-border pb-4"
          >
            <input type="hidden" name="slug" value={slug} />
            <label className="flex flex-col gap-1">
              <span className="text-[11px] text-muted uppercase">Package</span>
              <select
                name="plan_code"
                required
                defaultValue={activeSub.plan_code}
                className="h-8 min-w-[12rem] rounded-[4px] border border-border px-2 text-[13px]"
              >
                {plans.map((p) => (
                  <option key={p.code} value={p.code}>
                    {p.name} — {formatZAR(p.monthly_cents)}/mo
                  </option>
                ))}
              </select>
            </label>
            <button
              type="submit"
              disabled={packagePending}
              className="h-8 rounded-[4px] bg-accent-strong px-3 text-[12px] font-semibold text-white hover:bg-primary disabled:opacity-60"
            >
              Change package
            </button>
            {packageState.error ? (
              <span className="text-[12px] text-status-error">
                {packageState.error}
              </span>
            ) : null}
            {packageState.message ? (
              <span className="text-[12px] text-status-ok">
                {packageState.message}
              </span>
            ) : null}
          </form>
        ) : null}

        {canEdit && activeSub ? (
          <form
            action={priceFormAction}
            className="flex flex-wrap items-end gap-2"
          >
            <input type="hidden" name="slug" value={slug} />
            <label className="flex flex-col gap-1">
              <span className="text-[11px] text-muted uppercase">
                Monthly price (ZAR)
              </span>
              <input
                name="monthly_price"
                required
                defaultValue={centsToInput(activeSub.current_monthly_cents)}
                placeholder="400"
                className="h-8 w-32 rounded-[4px] border border-border px-2 font-mono text-[13px] tabular-nums"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] text-muted uppercase">
                Note (optional)
              </span>
              <input
                name="note"
                placeholder="Discount agreed verbally"
                className="h-8 w-56 rounded-[4px] border border-border px-2 text-[13px]"
              />
            </label>
            <button
              type="submit"
              disabled={pricePending}
              className="h-8 rounded-[4px] border border-border px-3 text-[12px] font-semibold hover:border-primary-light hover:bg-primary hover:text-white disabled:opacity-60"
            >
              Update price
            </button>
            {priceState.error ? (
              <span className="text-[12px] text-status-error">
                {priceState.error}
              </span>
            ) : null}
            {priceState.message ? (
              <span className="text-[12px] text-status-ok">
                {priceState.message}
              </span>
            ) : null}
          </form>
        ) : null}
        <p className="mt-2 text-[11px] text-muted">
          Change package switches to the catalog price for that plan and
          refreshes draft invoices. Use Update price for discounts. Lifecycle
          “Change plan” still schedules a next-cycle switch if you prefer that.
        </p>
      </section>

      <section className="rounded-[4px] border border-border bg-surface p-4">
        <h3 className="mb-3 text-[12px] font-semibold tracking-wide text-muted uppercase">
          Billing day
        </h3>
        <p className="mb-3 text-[13px]">
          <span className="text-muted">Billed on day</span>{" "}
          <span className="font-semibold tabular-nums">{billingDay}</span>{" "}
          of each month (invoice due date)
        </p>
        {canEdit ? (
          <form
            action={termsFormAction}
            className="flex flex-wrap items-end gap-2"
          >
            <input type="hidden" name="slug" value={slug} />
            <label className="flex flex-col gap-1">
              <span className="text-[11px] text-muted uppercase">
                Day of month (1–28)
              </span>
              <input
                name="billing_day"
                type="number"
                min={1}
                max={28}
                required
                defaultValue={billingDay}
                className="h-8 w-24 rounded-[4px] border border-border px-2 font-mono text-[13px] tabular-nums"
              />
            </label>
            <button
              type="submit"
              disabled={termsPending}
              className="h-8 rounded-[4px] bg-accent-strong px-3 text-[12px] font-semibold text-white disabled:opacity-60"
            >
              Update billing day
            </button>
            {termsState.error ? (
              <span className="text-[12px] text-status-error">
                {termsState.error}
              </span>
            ) : null}
            {termsState.message ? (
              <span className="text-[12px] text-status-ok">
                {termsState.message}
              </span>
            ) : null}
          </form>
        ) : null}
        <p className="mt-2 text-[11px] text-muted">
          Default is the 1st. Applies to newly issued invoices. On Activate, a
          draft is created for the signup calendar month.
        </p>
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
          Expenses & addons
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
                  No expenses yet
                </td>
              </tr>
            ) : (
              addons.map((a) => (
                <tr key={a.id}>
                  <td>{a.description}</td>
                  <td className="font-mono text-[12px]">
                    {a.kind === "once_off" ? "Once-off" : "Recurring"}
                  </td>
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
                    {canBill && !a.active_until ? (
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

        {canBill ? (
          <form action={addonFormAction} className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="slug" value={slug} />
            <label className="flex flex-col gap-1">
              <span className="text-[11px] text-muted uppercase">Description</span>
              <input
                name="description"
                required
                placeholder="Domain renewal, extra mailbox…"
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
              <span className="text-[11px] text-muted uppercase">Amount (ZAR)</span>
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
              Add expense
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
          Recurring expenses bill every cycle from next month. Once-off expenses
          appear on the next invoice only.
        </p>
      </section>

      <section className="rounded-[4px] border border-border bg-surface p-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h3 className="text-[12px] font-semibold tracking-wide text-muted uppercase">
            Invoices
          </h3>
          <Link
            href={`/invoices/new?tenant=${encodeURIComponent(slug)}`}
            className="text-[12px] font-semibold text-accent-strong hover:underline"
          >
            New custom invoice
          </Link>
        </div>
        <table className="admin-table">
          <thead>
            <tr>
              <th>Number</th>
              <th>Status</th>
              <th>Period</th>
              <th className="text-right">Total</th>
              <th>PDF</th>
            </tr>
          </thead>
          <tbody>
            {invoices.length === 0 ? (
              <tr>
                <td colSpan={5} className="text-muted">
                  No invoices yet
                </td>
              </tr>
            ) : (
              invoices.map((inv) => (
                <tr key={inv.id}>
                  <td className="font-mono text-[12px]">
                    <Link
                      href={`/invoices/${inv.id}`}
                      className="text-accent-strong hover:underline"
                    >
                      {inv.invoice_number ?? `draft #${inv.id}`}
                    </Link>
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
                  <td>
                    {inv.has_pdf ? (
                      <a
                        href={`/invoices/${inv.id}/pdf`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[12px] font-semibold text-accent-strong hover:underline"
                      >
                        View
                      </a>
                    ) : (
                      <span className="text-[12px] text-muted">—</span>
                    )}
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
