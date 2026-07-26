"use client";

import { useActionState, useState } from "react";
import { Money, StatusPill } from "@/components/ui/status";
import { formatCentsPlain } from "@/lib/money";
import type { PlanRecord } from "@/lib/plans/queries";
import { updatePlanAction, type PlanActionState } from "./actions";

const empty: PlanActionState = {};

function pctLabel(rate: number): string {
  if (rate <= 0) return "Flat";
  return `${Number((rate * 100).toFixed(2))}%`;
}

export function PlansClient({ plans }: { plans: PlanRecord[] }) {
  const [state, action, pending] = useActionState(updatePlanAction, empty);
  const [editing, setEditing] = useState<string | null>(null);

  return (
    <div className="space-y-5">
      <section className="rounded-[4px] border border-border bg-surface p-4">
        <h2 className="text-[13px] font-semibold">Pricing catalog</h2>
        <p className="mt-1 text-[12px] text-muted">
          The single source of truth for what a plan costs and whether it earns
          commission. Editing a plan changes the default offered to new tenants
          and the commission policy applied to future drafts. It never re-prices
          an existing tenant — each tenant keeps the monthly figure they were
          sold — and never alters an invoice that has already been generated.
        </p>
      </section>

      {state.error ? (
        <div className="rounded-[4px] border border-status-error bg-status-error/10 p-3 text-[13px] text-status-error">
          {state.error}
        </div>
      ) : null}
      {state.message ? (
        <div className="rounded-[4px] border border-status-ok bg-status-ok/10 p-3 text-[13px] text-status-ok">
          {state.message}
        </div>
      ) : null}

      <div className="overflow-x-auto">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Plan</th>
              <th>Line</th>
              <th className="text-right">Base / month</th>
              <th className="text-right">Commission</th>
              <th className="text-right">Graduates above</th>
              <th>Eligibility</th>
              <th className="text-right">Tenants</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {plans.map((p) => (
              <tr key={p.code}>
                <td>
                  <div className="font-medium">{p.name}</div>
                  <div className="font-mono text-[11px] text-muted">{p.code}</div>
                </td>
                <td className="text-[12px] uppercase">{p.productLine}</td>
                <td className="text-right">
                  <Money cents={p.monthlyCents} />
                </td>
                <td className="text-right text-[12px]">
                  {p.commissionRate > 0 ? (
                    <span className="font-semibold text-accent-strong">
                      {pctLabel(p.commissionRate)} of gross
                    </span>
                  ) : (
                    <span className="text-muted">Flat</span>
                  )}
                </td>
                <td className="text-right text-[12px]">
                  {p.graduationThresholdCents === null ? (
                    <span className="text-muted">—</span>
                  ) : (
                    <>
                      <Money cents={p.graduationThresholdCents} />
                      {p.graduateToCode ? (
                        <div className="text-[11px] text-muted">
                          → {p.graduateToCode}
                        </div>
                      ) : null}
                    </>
                  )}
                </td>
                <td className="text-[12px]">{p.eligibility ?? "—"}</td>
                <td className="text-right font-mono text-[12px]">
                  {p.tenantCount}
                </td>
                <td>
                  <StatusPill
                    tone={p.active ? "ok" : "idle"}
                    label={p.active ? "Active" : "Retired"}
                  />
                </td>
                <td className="text-right">
                  <button
                    type="button"
                    onClick={() => setEditing(editing === p.code ? null : p.code)}
                    className="text-[12px] font-semibold text-accent-strong hover:underline"
                  >
                    {editing === p.code ? "Close" : "Edit"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {plans
        .filter((p) => p.code === editing)
        .map((p) => (
          <section
            key={p.code}
            className="rounded-[4px] border border-primary-light bg-surface p-4"
          >
            <h3 className="mb-3 text-[13px] font-semibold">
              Edit {p.name} ({p.code})
            </h3>
            <form action={action} className="flex flex-wrap items-end gap-3">
              <input type="hidden" name="code" value={p.code} />
              <label className="flex min-w-[10rem] flex-col gap-1 text-[12px]">
                <span className="text-muted uppercase">Name</span>
                <input
                  name="name"
                  defaultValue={p.name}
                  required
                  className="h-8 rounded-[4px] border border-border px-2 text-[13px]"
                />
              </label>
              <label className="flex w-[9rem] flex-col gap-1 text-[12px]">
                <span className="text-muted uppercase">Base / month (R)</span>
                <input
                  name="monthly"
                  defaultValue={formatCentsPlain(p.monthlyCents)}
                  required
                  className="h-8 rounded-[4px] border border-border px-2 text-right font-mono text-[13px]"
                />
              </label>
              <label className="flex w-[8rem] flex-col gap-1 text-[12px]">
                <span className="text-muted uppercase">Commission %</span>
                <input
                  name="commission"
                  defaultValue={String(
                    Number((p.commissionRate * 100).toFixed(2)),
                  )}
                  className="h-8 rounded-[4px] border border-border px-2 text-right font-mono text-[13px]"
                />
              </label>
              <label className="flex w-[10rem] flex-col gap-1 text-[12px]">
                <span className="text-muted uppercase">Graduate above (R)</span>
                <input
                  name="graduation_threshold"
                  defaultValue={
                    p.graduationThresholdCents === null
                      ? ""
                      : formatCentsPlain(p.graduationThresholdCents)
                  }
                  placeholder="blank = never"
                  className="h-8 rounded-[4px] border border-border px-2 text-right font-mono text-[13px]"
                />
              </label>
              <label className="flex w-[10rem] flex-col gap-1 text-[12px]">
                <span className="text-muted uppercase">Graduate to</span>
                <select
                  name="graduate_to_code"
                  defaultValue={p.graduateToCode ?? ""}
                  className="h-8 rounded-[4px] border border-border px-2 text-[13px]"
                >
                  <option value="">—</option>
                  {plans
                    .filter((o) => o.code !== p.code && o.commissionRate === 0)
                    .map((o) => (
                      <option key={o.code} value={o.code}>
                        {o.name}
                      </option>
                    ))}
                </select>
              </label>
              <label className="flex min-w-[10rem] flex-col gap-1 text-[12px]">
                <span className="text-muted uppercase">Eligibility</span>
                <input
                  name="eligibility"
                  defaultValue={p.eligibility ?? ""}
                  placeholder="e.g. online-only"
                  className="h-8 rounded-[4px] border border-border px-2 text-[13px]"
                />
              </label>
              <label className="flex items-center gap-2 text-[12px]">
                <input
                  type="checkbox"
                  name="active"
                  defaultChecked={p.active}
                />
                <span>Available to new tenants</span>
              </label>
              <button
                type="submit"
                disabled={pending}
                className="h-8 rounded-[4px] bg-accent-strong px-3 text-[12px] font-semibold text-white hover:bg-primary disabled:opacity-50"
              >
                {pending ? "Saving…" : "Save plan"}
              </button>
            </form>
            {p.tenantCount > 0 ? (
              <p className="mt-2 text-[11px] text-muted">
                {p.tenantCount} tenant(s) are on this plan. Their monthly price
                is unchanged by this edit — adjust an individual price on the
                tenant&apos;s billing tab.
              </p>
            ) : null}
          </section>
        ))}
    </div>
  );
}
