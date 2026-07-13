"use client";

import { useActionState, useState, useTransition } from "react";
import {
  activateTenantAction,
  changePlanAction,
  offboardTenantAction,
  suspendTenantAction,
  unsuspendTenantAction,
  type ActionState,
} from "@/app/(console)/tenants/actions";
import { firstDayOfNextMonth, lastDayOfThisMonth } from "@/lib/billing/cycle";
import { formatZAR } from "@/lib/money";
import type { TenantStatus } from "@/lib/tenants/types";

const empty: ActionState = {};

type PlanOption = { code: string; name: string; monthly_cents: number };

export function LifecyclePanel({
  slug,
  status,
  plans,
  currentPlanCode,
}: {
  slug: string;
  status: TenantStatus;
  plans: PlanOption[];
  currentPlanCode: string | null;
}) {
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [showPlan, setShowPlan] = useState(false);
  const [showSuspend, setShowSuspend] = useState(false);
  const [showOffboard, setShowOffboard] = useState(false);
  const [planState, planAction, planPending] = useActionState(
    changePlanAction,
    empty,
  );
  const [offboardState, offboardAction, offboardPending] = useActionState(
    offboardTenantAction,
    empty,
  );

  const endsOn = lastDayOfThisMonth();
  const effectiveOn = firstDayOfNextMonth();

  function run(fn: () => Promise<ActionState>) {
    setMessage(null);
    setError(null);
    startTransition(async () => {
      const result = await fn();
      if (result.error) setError(result.error);
      else if (result.message) setMessage(result.message);
    });
  }

  if (status === "offboarded") {
    return (
      <div className="rounded-[4px] border border-status-error/30 bg-status-error/8 px-3 py-2 text-[12px] text-status-error">
        Offboarded. Financial history is retained. There is no hard delete.
      </div>
    );
  }

  return (
    <div className="rounded-[4px] border border-border bg-surface p-3">
      <div className="flex flex-wrap gap-2">
        {status === "prospect" ? (
          <button
            type="button"
            disabled={pending}
            onClick={() => run(() => activateTenantAction(slug))}
            className="h-8 rounded-[4px] bg-accent-strong px-3 text-[12px] font-semibold text-white disabled:opacity-60"
          >
            Activate
          </button>
        ) : null}

        {status === "active" || status === "suspended" ? (
          <button
            type="button"
            onClick={() => {
              setShowPlan((v) => !v);
              setShowSuspend(false);
              setShowOffboard(false);
            }}
            className="h-8 rounded-[4px] border border-border px-3 text-[12px] font-medium hover:border-primary-light"
          >
            Change plan
          </button>
        ) : null}

        {status === "active" ? (
          <button
            type="button"
            onClick={() => {
              setShowSuspend((v) => !v);
              setShowPlan(false);
              setShowOffboard(false);
            }}
            className="h-8 rounded-[4px] border border-status-warn/40 px-3 text-[12px] font-medium text-status-warn hover:bg-status-warn/8"
          >
            Suspend
          </button>
        ) : null}

        {status === "suspended" ? (
          <button
            type="button"
            disabled={pending}
            onClick={() => run(() => unsuspendTenantAction(slug))}
            className="h-8 rounded-[4px] bg-accent-strong px-3 text-[12px] font-semibold text-white disabled:opacity-60"
          >
            Unsuspend
          </button>
        ) : null}

        <button
          type="button"
          onClick={() => {
            setShowOffboard((v) => !v);
            setShowPlan(false);
            setShowSuspend(false);
          }}
          className="h-8 rounded-[4px] border border-status-error px-3 text-[12px] font-medium text-status-error hover:bg-status-error hover:text-white"
        >
          Offboard
        </button>
      </div>

      {showPlan ? (
        <form action={planAction} className="mt-3 space-y-2 border-t border-border pt-3">
          <input type="hidden" name="slug" value={slug} />
          <p className="text-[12px] text-muted">
            No pro-rata. Current plan ends{" "}
            <strong className="font-mono text-foreground">{endsOn}</strong>. New
            plan takes effect{" "}
            <strong className="font-mono text-foreground">{effectiveOn}</strong>.
            Existing subscription price is never mutated.
          </p>
          <select
            name="plan_code"
            required
            defaultValue={
              plans.find((p) => p.code !== currentPlanCode)?.code ??
              plans[0]?.code
            }
            className="h-8 rounded-[4px] border border-border px-2 text-[13px]"
          >
            {plans.map((p) => (
              <option
                key={p.code}
                value={p.code}
                disabled={p.code === currentPlanCode}
              >
                {p.name} — {formatZAR(p.monthly_cents)}/mo
                {p.code === currentPlanCode ? " (current)" : ""}
              </option>
            ))}
          </select>
          <button
            type="submit"
            disabled={planPending}
            className="ml-2 h-8 rounded-[4px] bg-accent-strong px-3 text-[12px] font-semibold text-white disabled:opacity-60"
          >
            Confirm plan change
          </button>
          {planState.error ? (
            <p className="text-[12px] text-status-error">{planState.error}</p>
          ) : null}
          {planState.message ? (
            <p className="text-[12px] text-status-ok">{planState.message}</p>
          ) : null}
        </form>
      ) : null}

      {showSuspend ? (
        <div className="mt-3 space-y-2 border-t border-border pt-3">
          <p className="text-[12px] text-status-warn">
            Suspend is a dunning action. Billing continues. This is not
            offboarding — the customer remains on the books and invoices still
            generate.
          </p>
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              setShowSuspend(false);
              run(() => suspendTenantAction(slug));
            }}
            className="h-8 rounded-[4px] border border-status-warn px-3 text-[12px] font-semibold text-status-warn hover:bg-status-warn hover:text-white"
          >
            Confirm suspend
          </button>
        </div>
      ) : null}

      {showOffboard ? (
        <form
          action={offboardAction}
          className="mt-3 space-y-2 border-t border-border pt-3"
        >
          <input type="hidden" name="slug" value={slug} />
          <p className="text-[12px] text-status-error">
            Offboard is how you remove a customer. There is no hard delete.
            Subscription cancels at period end (
            <span className="font-mono">{endsOn}</span>). Invoices, payments, and
            credit notes are retained. A JSON + CSV export will download.
          </p>
          <label className="block text-[12px]">
            Type <span className="font-mono font-semibold">{slug}</span> to
            confirm
            <input
              name="confirm_slug"
              required
              autoComplete="off"
              className="mt-1 block h-8 w-full max-w-xs rounded-[4px] border border-status-error/40 px-2 font-mono text-[13px]"
            />
          </label>
          <button
            type="submit"
            disabled={offboardPending}
            className="h-8 rounded-[4px] border border-status-error px-3 text-[12px] font-semibold text-status-error hover:bg-status-error hover:text-white disabled:opacity-60"
          >
            Confirm offboard
          </button>
          {offboardState.error ? (
            <p className="text-[12px] text-status-error">
              {offboardState.error}
            </p>
          ) : null}
        </form>
      ) : null}

      {error ? (
        <p className="mt-2 text-[12px] text-status-error">{error}</p>
      ) : null}
      {message ? (
        <p className="mt-2 text-[12px] text-status-ok">{message}</p>
      ) : null}
    </div>
  );
}
