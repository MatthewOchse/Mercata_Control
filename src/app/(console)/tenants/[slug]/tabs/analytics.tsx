"use client";

import Link from "next/link";
import type { TenantAnalyticsView } from "@/lib/analytics/queries";
import {
  BarChart,
  LineChart,
  shortDateLabel,
} from "@/components/charts/LineChart";
import { Money } from "@/components/ui/status";
import { formatSastDateTime } from "@/lib/datetime";
import { formatZAR } from "@/lib/money";

function Pct({ value }: { value: number | null }) {
  if (value === null) return <span className="text-muted">—</span>;
  if (value === 0) return <span className="text-muted">0%</span>;
  const up = value > 0;
  return (
    <span className={up ? "text-status-ok" : "text-status-error"}>
      {up ? "↑" : "↓"} {Math.abs(value)}%
    </span>
  );
}

const PERIODS = [
  ["1d", "Yesterday"],
  ["7d", "7d"],
  ["28d", "28d"],
  ["90d", "90d"],
  ["this_vs_last_month", "Month"],
] as const;

export function AnalyticsTab({
  slug,
  view,
  tab = "analytics",
}: {
  slug: string;
  view: TenantAnalyticsView;
  /** Keep period filters on the current tab (overview vs analytics). */
  tab?: "analytics" | "overview";
}) {
  const period = view.period.key;
  const xLabels = view.series.map((s) => ({
    label: shortDateLabel(s.date),
  }));

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1">
          {PERIODS.map(([key, label]) => (
            <Link
              key={key}
              href={`/tenants/${slug}?tab=${tab}&period=${key}`}
              className={`inline-flex h-7 items-center rounded-[4px] px-2 text-[12px] font-semibold ${
                period === key
                  ? "bg-accent-strong text-white"
                  : "border border-border hover:border-primary-light"
              }`}
            >
              {label}
            </Link>
          ))}
        </div>
        <p className="text-[11px] text-muted">
          {view.period.label} · data as of{" "}
          {view.dataAsOf ? formatSastDateTime(view.dataAsOf) : "—"}
          . Traffic for the last 48h may still settle; sales do not.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile
          label="Revenue"
          value={
            <Money
              cents={view.revenueCents}
              className="text-accent-strong tabular-nums"
            />
          }
          change={<Pct value={view.revenuePct} />}
        />
        <Tile
          label="Orders"
          value={<span className="tabular-nums">{view.orders}</span>}
          change={<Pct value={view.ordersPct} />}
        />
        <Tile
          label="Sessions"
          value={
            view.sessions === null ? (
              <span className="text-muted">—</span>
            ) : (
              <span className="tabular-nums">{view.sessions}</span>
            )
          }
          change={<Pct value={view.sessionsPct} />}
        />
        {view.conversionRate !== null ? (
          <Tile
            label="Conversion"
            value={
              <span className="tabular-nums">{view.conversionRate}%</span>
            }
            change={<Pct value={view.conversionPct} />}
          />
        ) : (
          <div className="hidden lg:block" />
        )}
      </div>

      <section className="rounded-[4px] border border-border bg-surface p-4">
        <h3 className="mb-1 text-[12px] font-semibold tracking-wide text-muted uppercase">
          Orders by day
        </h3>
        <LineChart
          xLabels={xLabels}
          height={150}
          series={[
            {
              id: "orders",
              label: "Orders",
              values: view.series.map((s) => s.orders),
              style: "solid",
              color: "var(--primary)",
            },
          ]}
        />
      </section>

      <section className="rounded-[4px] border border-border bg-surface p-4">
        <h3 className="mb-1 text-[12px] font-semibold tracking-wide text-muted uppercase">
          Sessions by day
        </h3>
        <LineChart
          xLabels={xLabels}
          height={150}
          emptyText={
            view.hasGa4 ? "No session data for this period" : "No GA4 data yet"
          }
          series={[
            {
              id: "sessions",
              label: "Sessions",
              values: view.series.map((s) => s.sessions ?? 0),
              style: "solid",
              color: "var(--accent-strong)",
            },
          ]}
        />
      </section>

      <section className="rounded-[4px] border border-border bg-surface p-4">
        <h3 className="mb-1 text-[12px] font-semibold tracking-wide text-muted uppercase">
          Net sales by day
        </h3>
        <p className="mb-3 text-[11px] text-muted">
          Daily net sales (ZAR). Hover a bar for the exact amount.
        </p>
        <BarChart
          values={view.series.map((s) => s.netCents / 100)}
          xLabels={xLabels}
          height={160}
          yFormat={(n) =>
            n >= 1000 ? `R${(n / 1000).toFixed(1)}k` : `R${Math.round(n)}`
          }
        />
        {view.series.length > 0 ? (
          <p className="mt-2 text-[11px] text-muted">
            Period total{" "}
            <span className="font-mono text-foreground">
              {formatZAR(view.revenueCents)}
            </span>
          </p>
        ) : null}
      </section>

      <div className="grid gap-4 lg:grid-cols-3">
        {view.topProducts.length > 0 ? (
          <Table
            title="Top products"
            rows={view.topProducts.map((p) => [p.description, String(p.units)])}
          />
        ) : null}
        {view.topPages.length > 0 ? (
          <Table
            title="Top pages"
            rows={view.topPages.map((p) => [p.path, String(p.views)])}
          />
        ) : null}
        {view.topSources.length > 0 ? (
          <Table
            title="Top sources"
            rows={view.topSources.map((s) => [s.source, String(s.sessions)])}
          />
        ) : null}
      </div>

      {!view.hasGa4 ? (
        <p className="text-[12px] text-muted">
          No GA4 data for this period.{" "}
          <Link
            href={`/tenants/${slug}?tab=digest`}
            className="text-accent-strong hover:underline"
          >
            Configure GA4 on Digest
          </Link>
          .
        </p>
      ) : null}
    </div>
  );
}

function Tile({
  label,
  value,
  change,
}: {
  label: string;
  value: React.ReactNode;
  change: React.ReactNode;
}) {
  return (
    <div className="rounded-[4px] border border-border bg-surface p-3">
      <div className="text-[11px] tracking-wide text-muted uppercase">
        {label}
      </div>
      <div className="mt-1 text-[18px] font-semibold">{value}</div>
      <div className="mt-1 text-[12px]">{change}</div>
    </div>
  );
}

function Table({
  title,
  rows,
}: {
  title: string;
  rows: [string, string][];
}) {
  return (
    <section className="rounded-[4px] border border-border bg-surface p-4">
      <h3 className="mb-2 text-[12px] font-semibold tracking-wide text-muted uppercase">
        {title}
      </h3>
      <table className="admin-table">
        <tbody>
          {rows.map(([a, b]) => (
            <tr key={a + b}>
              <td className="max-w-[12rem] truncate">{a}</td>
              <td className="text-right font-mono text-[12px] tabular-nums">
                {b}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
