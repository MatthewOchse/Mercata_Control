import Link from "next/link";
import { TopBar } from "@/components/layout/top-bar";
import { LineChart } from "@/components/charts/LineChart";
import { Money } from "@/components/ui/status";
import { getRevenueOverview } from "@/lib/analytics/revenue";
import { formatZAR } from "@/lib/money";

function Card({
  label,
  value,
  hint,
  accent,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  accent?: boolean;
  tone?: "warn" | "error" | "ok";
}) {
  const valueClass =
    tone === "error"
      ? "text-status-error"
      : tone === "warn"
        ? "text-status-warn"
        : tone === "ok"
          ? "text-status-ok"
          : accent
            ? "text-accent-strong"
            : "";
  return (
    <div className="rounded-[4px] border border-border bg-surface p-3">
      <div className="text-[11px] font-semibold tracking-wide text-muted uppercase">
        {label}
      </div>
      <div className={`mt-1 text-[18px] font-semibold tabular-nums ${valueClass}`}>
        {value}
      </div>
      {hint ? <div className="mt-0.5 text-[10px] text-muted">{hint}</div> : null}
    </div>
  );
}

export default async function RevenuePage() {
  const rev = await getRevenueOverview(12);

  const flatSeries = rev.trend.map((m) => m.flatCents / 100);
  const commissionSeries = rev.trend.map((m) => m.commissionCents / 100);
  const xLabels = rev.trend.map((m, i) => ({
    label:
      i === 0 || i === rev.trend.length - 1
        ? m.label.replace(/ \d{4}$/, "")
        : "",
  }));

  const growth = rev.momGrowthPct;

  return (
    <>
      <TopBar title="Revenue" />
      <main className="space-y-5 p-5">
        <section className="grid grid-cols-2 gap-3 lg:grid-cols-6">
          <Card
            label="MRR"
            value={formatZAR(rev.mrrCents)}
            hint="contracted recurring, excludes commission"
            accent
          />
          <Card
            label="ARR"
            value={formatZAR(rev.arrCents)}
            hint="MRR × 12"
          />
          <Card
            label="MoM growth"
            value={growth === null ? "—" : `${growth > 0 ? "+" : ""}${growth}%`}
            hint="recurring billed, month on month"
            tone={
              growth === null ? undefined : growth >= 0 ? "ok" : "error"
            }
          />
          <Card
            label="Active tenants"
            value={String(rev.activeTenants)}
            hint={
              rev.activeTenants > 0
                ? `${formatZAR(Math.trunc(rev.mrrCents / rev.activeTenants))} avg MRR`
                : undefined
            }
          />
          <Card
            label="Commission this month"
            value={formatZAR(rev.thisMonth?.commissionCents ?? 0)}
            hint={rev.thisMonth ? `of ${formatZAR(rev.thisMonth.totalCents)} billed` : "nothing billed yet"}
            accent
          />
          <Card
            label="Churned MRR"
            value={formatZAR(rev.churnedMrrCents)}
            hint={`${rev.churn.length} tenant(s) lost this month`}
            tone={rev.churn.length > 0 ? "error" : undefined}
          />
        </section>

        <section className="rounded-[4px] border border-border bg-surface p-4">
          <h2 className="text-[13px] font-semibold">Billed revenue by month</h2>
          <p className="mt-1 mb-3 text-[11px] text-muted">
            Invoiced totals per billing period, split between flat fees and
            commission. Commission is variable, so it appears here but never in
            MRR. Drafts are excluded — only issued, paid and overdue invoices
            count.
          </p>
          {rev.trend.length === 0 ? (
            <p className="text-[12px] text-muted">
              No invoices issued yet — the chart appears after your first billing
              run.
            </p>
          ) : (
            <LineChart
              height={220}
              emptyText="No revenue history yet"
              format="zar"
              xLabels={xLabels}
              series={[
                {
                  id: "flat",
                  label: "Flat fees",
                  values: flatSeries,
                  color: "var(--primary)",
                },
                {
                  id: "commission",
                  label: "Commission",
                  values: commissionSeries,
                  color: "var(--accent-strong)",
                },
              ]}
            />
          )}
        </section>

        <div className="grid gap-5 lg:grid-cols-2">
          <section className="rounded-[4px] border border-border bg-surface p-4">
            <h2 className="mb-3 text-[13px] font-semibold">Tenants by plan</h2>
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Plan</th>
                  <th className="text-right">Tenants</th>
                  <th className="text-right">MRR</th>
                  <th className="text-right">Share</th>
                </tr>
              </thead>
              <tbody>
                {rev.planBreakdown
                  .filter((p) => p.tenantCount > 0)
                  .map((p) => (
                    <tr key={p.planCode}>
                      <td>
                        {p.planName}
                        {p.commissionRate > 0 ? (
                          <span className="ml-1 text-[10px] text-accent-strong">
                            +{Number((p.commissionRate * 100).toFixed(2))}%
                          </span>
                        ) : null}
                      </td>
                      <td className="text-right font-mono text-[12px]">
                        {p.tenantCount}
                      </td>
                      <td className="text-right">
                        <Money cents={p.mrrCents} className="text-[12px]" />
                      </td>
                      <td className="text-right font-mono text-[12px] text-muted">
                        {rev.mrrCents > 0
                          ? `${Math.round((p.mrrCents / rev.mrrCents) * 100)}%`
                          : "—"}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </section>

          <section className="rounded-[4px] border border-border bg-surface p-4">
            <h2 className="mb-3 text-[13px] font-semibold">
              Churn this month
            </h2>
            {rev.churn.length === 0 ? (
              <p className="text-[12px] text-status-ok">
                No tenants lost this month.
              </p>
            ) : (
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Tenant</th>
                    <th>Plan</th>
                    <th>Offboarded</th>
                    <th className="text-right">MRR lost</th>
                  </tr>
                </thead>
                <tbody>
                  {rev.churn.map((c) => (
                    <tr key={c.tenantId}>
                      <td>
                        <Link
                          href={`/tenants/${c.slug}`}
                          className="hover:text-accent-strong"
                        >
                          {c.tradingName}
                        </Link>
                      </td>
                      <td className="text-[12px]">{c.planName ?? "—"}</td>
                      <td className="font-mono text-[11px]">
                        {c.offboardedOn}
                      </td>
                      <td className="text-right">
                        <Money
                          cents={c.lostMrrCents}
                          className="text-[12px] text-status-error"
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </div>

        <section className="rounded-[4px] border border-border bg-surface p-4">
          <h2 className="mb-3 text-[13px] font-semibold">Revenue per tenant</h2>
          <div className="overflow-x-auto">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Tenant</th>
                  <th>Plan</th>
                  <th className="text-right">MRR</th>
                  <th className="text-right">Commission billed</th>
                  <th className="text-right">Billed this month</th>
                  <th className="text-right">Share of MRR</th>
                </tr>
              </thead>
              <tbody>
                {rev.perTenant.map((t) => (
                  <tr key={t.tenantId}>
                    <td>
                      <Link
                        href={`/tenants/${t.slug}`}
                        className="font-medium hover:text-accent-strong"
                      >
                        {t.tradingName}
                      </Link>
                    </td>
                    <td className="text-[12px]">{t.planName ?? "—"}</td>
                    <td className="text-right">
                      <Money cents={t.mrrCents} className="text-[12px]" />
                    </td>
                    <td className="text-right text-[12px]">
                      {t.commissionThisMonthCents > 0 ? (
                        <Money
                          cents={t.commissionThisMonthCents}
                          className="text-accent-strong"
                        />
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>
                    <td className="text-right">
                      <Money
                        cents={t.billedThisMonthCents}
                        className="text-[12px]"
                      />
                    </td>
                    <td className="text-right font-mono text-[12px] text-muted">
                      {rev.mrrCents > 0
                        ? `${Math.round((t.mrrCents / rev.mrrCents) * 100)}%`
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </>
  );
}
