"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Money, StatusPill } from "@/components/ui/status";
import { formatZAR } from "@/lib/money";
import type { LifecycleRow, LifecycleView } from "@/lib/dashboard/lifecycle";

type SortKey = "mrr" | "sales" | "standing" | "name";

const STANDING_ORDER: Record<LifecycleRow["standing"], number> = {
  overdue: 0,
  current: 1,
  unbilled: 2,
};

function standingPill(row: LifecycleRow) {
  if (row.standing === "overdue") {
    return (
      <StatusPill
        tone="error"
        label={`Overdue ×${row.overdueCount}`}
      />
    );
  }
  if (row.standing === "current") {
    return <StatusPill tone="warn" label="Awaiting payment" />;
  }
  return <StatusPill tone="ok" label="Settled" />;
}

export function TenantLifecycleBoard({ view }: { view: LifecycleView }) {
  const [plan, setPlan] = useState("all");
  const [standing, setStanding] = useState("all");
  const [server, setServer] = useState("all");
  const [sort, setSort] = useState<SortKey>("mrr");

  const rows = useMemo(() => {
    const filtered = view.rows.filter((r) => {
      if (plan !== "all" && r.planCode !== plan) return false;
      if (standing !== "all" && r.standing !== standing) return false;
      if (server !== "all" && (r.server ?? "") !== server) return false;
      return true;
    });

    return [...filtered].sort((a, b) => {
      if (sort === "mrr") return b.mrrCents - a.mrrCents;
      if (sort === "sales") {
        return (b.salesGrossCents ?? -1) - (a.salesGrossCents ?? -1);
      }
      if (sort === "standing") {
        return (
          STANDING_ORDER[a.standing] - STANDING_ORDER[b.standing] ||
          b.outstandingCents - a.outstandingCents
        );
      }
      return a.tradingName.localeCompare(b.tradingName);
    });
  }, [view.rows, plan, standing, server, sort]);

  const s = view.summary;
  const shownMrr = rows.reduce((acc, r) => acc + r.mrrCents, 0);

  return (
    <div className="space-y-4">
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-6">
        <Card label="Active tenants" value={String(s.activeTenants)}>
          {s.suspendedTenants > 0
            ? `${s.suspendedTenants} suspended`
            : "none suspended"}
        </Card>
        <Card label="MRR" value={formatZAR(s.mrrCents)} accent>
          contracted recurring
        </Card>
        <Card
          label={`Flat billed ${s.billingMonthLabel}`}
          value={formatZAR(s.flatRevenueCents)}
        >
          base fees and add-ons
        </Card>
        <Card
          label="Commission billed"
          value={formatZAR(s.commissionRevenueCents)}
          accent
        >
          on {s.salesMonthLabel} sales
        </Card>
        <Card
          label="Overdue"
          value={String(s.overdueTenants)}
          tone={s.overdueTenants > 0 ? "error" : undefined}
        >
          {formatZAR(s.outstandingCents)} outstanding
        </Card>
        <Card
          label="Needs a look"
          value={String(s.missingSalesCount + s.serversOverWarn)}
          tone={
            s.missingSalesCount + s.serversOverWarn > 0 ? "warn" : undefined
          }
        >
          {s.missingSalesCount} missing sales, {s.serversOverWarn} full server(s)
        </Card>
      </section>

      <section className="rounded-[4px] border border-border bg-surface p-4">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-[13px] font-semibold">Tenants</h2>
            <p className="text-[11px] text-muted">
              {rows.length} of {view.rows.length} shown ·{" "}
              {formatZAR(shownMrr)} MRR · sales column is {s.salesMonthLabel}{" "}
              gross, all channels
            </p>
          </div>
          <div className="flex flex-wrap gap-2 text-[12px]">
            <Select
              label="Plan"
              value={plan}
              onChange={setPlan}
              options={[
                { value: "all", label: "All plans" },
                ...view.plans.map((p) => ({ value: p.code, label: p.name })),
              ]}
            />
            <Select
              label="Payment"
              value={standing}
              onChange={setStanding}
              options={[
                { value: "all", label: "Any status" },
                { value: "overdue", label: "Overdue" },
                { value: "current", label: "Awaiting payment" },
                { value: "unbilled", label: "Settled" },
              ]}
            />
            <Select
              label="Server"
              value={server}
              onChange={setServer}
              options={[
                { value: "all", label: "All servers" },
                ...view.servers.map((h) => ({ value: h, label: h })),
              ]}
            />
            <Select
              label="Sort"
              value={sort}
              onChange={(v) => setSort(v as SortKey)}
              options={[
                { value: "mrr", label: "MRR" },
                { value: "sales", label: "Sales" },
                { value: "standing", label: "Payment status" },
                { value: "name", label: "Name" },
              ]}
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Tenant</th>
                <th>Plan</th>
                <th className="text-right">MRR</th>
                <th className="text-right">{s.salesMonthLabel} gross</th>
                <th>Payment</th>
                <th>Server</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-muted">
                    No tenants match these filters.
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr key={r.tenantId}>
                    <td>
                      <Link
                        href={`/tenants/${r.slug}`}
                        className="font-medium hover:text-accent-strong"
                      >
                        {r.tradingName}
                      </Link>
                      {r.status === "suspended" ? (
                        <span className="ml-2 text-[10px] text-status-warn uppercase">
                          suspended
                        </span>
                      ) : null}
                    </td>
                    <td className="text-[12px]">
                      {r.planName ?? "—"}
                      {r.commissionRate > 0 ? (
                        <span className="ml-1 text-[10px] text-accent-strong">
                          +{Number((r.commissionRate * 100).toFixed(2))}%
                        </span>
                      ) : null}
                    </td>
                    <td className="text-right">
                      <Money cents={r.mrrCents} className="text-[12px]" />
                    </td>
                    <td className="text-right text-[12px]">
                      {r.salesGrossCents !== null ? (
                        <Money cents={r.salesGrossCents} />
                      ) : r.commissionRate > 0 ? (
                        <span className="text-status-warn">not read</span>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>
                    <td>{standingPill(r)}</td>
                    <td className="font-mono text-[11px] text-muted">
                      {r.server ? (
                        <Link href="/servers" className="hover:text-accent-strong">
                          {r.server}
                        </Link>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="text-right">
                      {r.graduationFlagId !== null ? (
                        <span
                          className="text-[10px] font-semibold text-status-warn"
                          title="Eligible to move to flat pricing"
                        >
                          ▲ graduate
                        </span>
                      ) : null}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function Card({
  label,
  value,
  children,
  accent,
  tone,
}: {
  label: string;
  value: string;
  children?: React.ReactNode;
  accent?: boolean;
  tone?: "warn" | "error";
}) {
  const valueClass = tone
    ? tone === "error"
      ? "text-status-error"
      : "text-status-warn"
    : accent
      ? "text-accent-strong"
      : undefined;
  return (
    <div className="rounded-[4px] border border-border bg-surface p-3">
      <div className="text-[11px] font-semibold tracking-wide text-muted uppercase">
        {label}
      </div>
      <div
        className={`mt-1 text-[17px] font-semibold tabular-nums ${valueClass ?? ""}`}
      >
        {value}
      </div>
      {children ? (
        <div className="mt-0.5 text-[10px] text-muted">{children}</div>
      ) : null}
    </div>
  );
}

function Select({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] tracking-wide text-muted uppercase">
        {label}
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-8 rounded-[4px] border border-border bg-background px-2 text-[12px]"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
