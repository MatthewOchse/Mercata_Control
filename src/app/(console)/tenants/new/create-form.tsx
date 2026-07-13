"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import {
  createTenantAction,
  type ActionState,
} from "@/app/(console)/tenants/actions";
import { formatZAR } from "@/lib/money";

const initial: ActionState = {};

type PlanOption = { code: string; name: string; monthly_cents: number };

export function CreateTenantForm({ plans }: { plans: PlanOption[] }) {
  const [state, formAction, pending] = useActionState(createTenantAction, initial);
  const [billingSame, setBillingSame] = useState(true);

  return (
    <form action={formAction} className="max-w-2xl space-y-5">
      <section className="rounded-[4px] border border-border bg-surface p-4">
        <h2 className="mb-3 text-[13px] font-semibold">Identity</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Legal name" name="legal_name" required />
          <Field label="Trading name" name="trading_name" required />
          <Field
            label="Slug"
            name="slug"
            required
            hint="lowercase, e.g. crafties"
            mono
          />
          <Field
            label="Primary domain"
            name="primary_domain"
            required
            hint="e.g. shop.crafties.co.za"
            mono
          />
        </div>
      </section>

      <section className="rounded-[4px] border border-border bg-surface p-4">
        <h2 className="mb-3 text-[13px] font-semibold">Primary contact</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Name" name="primary_name" required />
          <Field label="Email" name="primary_email" type="email" required />
          <Field label="Phone" name="primary_phone" />
        </div>
      </section>

      <section className="rounded-[4px] border border-border bg-surface p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-[13px] font-semibold">Billing contact</h2>
          <label className="flex items-center gap-2 text-[12px] text-muted">
            <input
              type="checkbox"
              name="billing_same"
              checked={billingSame}
              onChange={(e) => setBillingSame(e.target.checked)}
            />
            Same as primary
          </label>
        </div>
        {!billingSame ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Name" name="billing_name" required />
            <Field label="Email" name="billing_email" type="email" required />
            <Field label="Phone" name="billing_phone" />
          </div>
        ) : null}
      </section>

      <section className="rounded-[4px] border border-border bg-surface p-4">
        <h2 className="mb-3 text-[13px] font-semibold">Plan &amp; setup</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 sm:col-span-2">
            <span className="text-[11px] font-semibold tracking-wide text-muted uppercase">
              Plan
            </span>
            <select
              name="plan_code"
              required
              defaultValue={plans[0]?.code}
              className="h-9 rounded-[4px] border border-border bg-surface px-3 text-[13px]"
            >
              {plans.map((p) => (
                <option key={p.code} value={p.code}>
                  {p.name} — {formatZAR(p.monthly_cents)}/mo
                </option>
              ))}
            </select>
          </label>
          <Field
            label="Setup fee (once-off)"
            name="setup_fee"
            defaultValue="3000"
            hint="Defaults to R3,000. Set 0 to skip."
            money
          />
        </div>
        <p className="mt-3 text-[12px] text-muted">
          Creates as <strong>prospect</strong>. Subscription is prepared but
          billing starts only when you Activate.
        </p>
      </section>

      {state.error ? (
        <p className="rounded-[4px] border border-status-error/30 bg-status-error/8 px-3 py-2 text-[12px] text-status-error">
          {state.error}
        </p>
      ) : null}

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="h-9 rounded-[4px] bg-accent-strong px-4 text-[13px] font-semibold text-white disabled:opacity-60"
        >
          {pending ? "Creating…" : "Create tenant"}
        </button>
        <Link href="/tenants" className="text-[13px] text-muted hover:text-foreground">
          Cancel
        </Link>
      </div>
    </form>
  );
}

function Field({
  label,
  name,
  required,
  type = "text",
  hint,
  mono,
  money,
  defaultValue,
}: {
  label: string;
  name: string;
  required?: boolean;
  type?: string;
  hint?: string;
  mono?: boolean;
  money?: boolean;
  defaultValue?: string;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] font-semibold tracking-wide text-muted uppercase">
        {label}
      </span>
      <input
        name={name}
        type={type}
        required={required}
        defaultValue={defaultValue}
        className={`h-9 rounded-[4px] border border-border bg-surface px-3 text-[13px] outline-none focus:border-accent-strong ${mono || money ? "font-mono" : ""} ${money ? "tabular-nums" : ""}`}
      />
      {hint ? <span className="text-[11px] text-muted">{hint}</span> : null}
    </label>
  );
}
