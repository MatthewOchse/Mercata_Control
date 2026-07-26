"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import {
  dismissGraduationAction,
  graduateTenantAction,
  type GraduationActionState,
} from "@/app/(console)/graduation-actions";
import { Money, StatusPill } from "@/components/ui/status";
import type { GraduationFlag } from "@/lib/billing/graduation";

export function GraduationActionList({ flags }: { flags: GraduationFlag[] }) {
  const [pending, start] = useTransition();
  const [state, setState] = useState<GraduationActionState>({});

  if (flags.length === 0) return null;

  return (
    <section className="rounded-[4px] border border-status-warn bg-status-warn/5 p-4">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <StatusPill tone="warn" label="Pricing" />
        <h2 className="text-[15px] font-semibold">
          Ready to graduate to flat pricing
        </h2>
      </div>
      <p className="mb-3 text-[12px] text-muted">
        These tenants exceeded their commission plan&apos;s threshold for two
        consecutive months. Moving them to the flat tier costs them less and
        makes your revenue predictable. Nothing changes until you act — the plan
        switch takes effect on the 1st and never alters past invoices.
      </p>

      {state.error ? (
        <div className="mb-3 rounded-[4px] border border-status-error bg-status-error/10 p-2 text-[12px] text-status-error">
          {state.error}
        </div>
      ) : null}
      {state.message ? (
        <div className="mb-3 rounded-[4px] border border-status-ok bg-status-ok/10 p-2 text-[12px] text-status-ok">
          {state.message}
        </div>
      ) : null}

      <table className="admin-table">
        <thead>
          <tr>
            <th>Tenant</th>
            <th className="text-right">Sales, two months</th>
            <th className="text-right">On {""}commission</th>
            <th className="text-right">On flat</th>
            <th className="text-right">Client saves</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {flags.map((f) => (
            <tr key={f.id}>
              <td>
                <Link
                  href={`/tenants/${f.slug}`}
                  className="font-medium text-accent-strong hover:underline"
                >
                  {f.tradingName}
                </Link>
                <div className="text-[11px] text-muted">
                  {f.fromPlanName} → {f.suggestedPlanName}
                </div>
              </td>
              <td className="text-right text-[12px]">
                <div>
                  {f.month1Label}: <Money cents={f.month1GrossCents} />
                </div>
                <div>
                  {f.month2Label}: <Money cents={f.month2GrossCents} />
                </div>
                <div className="text-[10px] text-muted">
                  threshold <Money cents={f.thresholdCents} />
                </div>
              </td>
              <td className="text-right">
                <Money cents={f.starterCostCents} className="text-[12px]" />
              </td>
              <td className="text-right">
                <Money cents={f.flatCostCents} className="text-[12px]" />
              </td>
              <td className="text-right">
                <Money
                  cents={Math.abs(f.savingCents)}
                  className={
                    f.savingCents > 0
                      ? "font-semibold text-status-ok"
                      : "text-muted"
                  }
                />
                <div className="text-[10px] text-muted">
                  {f.savingCents > 0 ? "per month" : "commission still cheaper"}
                </div>
              </td>
              <td className="text-right whitespace-nowrap">
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => {
                    if (
                      !confirm(
                        `Move ${f.tradingName} from ${f.fromPlanName} to ${f.suggestedPlanName}? Effective the 1st of next month.`,
                      )
                    ) {
                      return;
                    }
                    start(async () => {
                      setState(
                        await graduateTenantAction({
                          flagId: f.id,
                          slug: f.slug,
                          fromPlanCode: f.fromPlanCode,
                          toPlanCode: f.suggestedPlanCode,
                        }),
                      );
                    });
                  }}
                  className="h-7 rounded-[4px] bg-accent-strong px-2 text-[11px] font-semibold text-white disabled:opacity-50"
                >
                  Graduate
                </button>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() =>
                    start(async () => {
                      setState(await dismissGraduationAction(f.id));
                    })
                  }
                  className="ml-2 text-[11px] text-muted hover:underline disabled:opacity-50"
                >
                  Dismiss
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
