"use client";

import Link from "next/link";
import { useTransition } from "react";
import {
  runPollNowAction,
  silenceOneHourAction,
} from "@/app/(console)/health/actions";
import { LineChart } from "@/components/charts/LineChart";
import { StatusPill, type StatusTone } from "@/components/ui/status";
import { formatSastDateTime } from "@/lib/datetime";
import type { HealthTile, IncidentRow } from "@/lib/health/dashboard";

export function HealthDashboardClient({
  tiles,
  incidents,
}: {
  tiles: HealthTile[];
  incidents: IncidentRow[];
}) {
  const [pending, startTransition] = useTransition();

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[13px] text-muted">
          Polls every 3 minutes via cron. Alerts fire on state change only.
        </p>
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            startTransition(() => {
              void runPollNowAction();
            })
          }
          className="h-8 rounded-[4px] border border-border px-3 text-[12px] font-medium hover:border-primary-light disabled:opacity-60"
        >
          Poll now
        </button>
      </div>

      {incidents.length > 0 ? (
        <section>
          <h2 className="mb-2 text-[12px] font-semibold tracking-wide text-muted uppercase">
            Active incidents
          </h2>
          <table className="admin-table">
            <thead>
              <tr>
                <th>Tenant</th>
                <th>Signal</th>
                <th>Severity</th>
                <th>Opened</th>
              </tr>
            </thead>
            <tbody>
              {incidents.map((inc) => (
                <tr key={`${inc.tenantId}-${inc.signal}`}>
                  <td>
                    <Link
                      href={`/tenants/${inc.slug}`}
                      className="hover:text-accent-strong"
                    >
                      {inc.tradingName}
                    </Link>
                  </td>
                  <td>{inc.label}</td>
                  <td>
                    <StatusPill
                      tone={
                        inc.severity === "critical" ? "error" : "warn"
                      }
                      label={
                        inc.severity === "critical" ? "Critical" : "Warning"
                      }
                    />
                  </td>
                  <td className="font-mono text-[11px]">
                    {formatSastDateTime(inc.openedAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : (
        <p className="text-[13px] text-muted">No active incidents.</p>
      )}

      <section>
        <h2 className="mb-2 text-[12px] font-semibold tracking-wide text-muted uppercase">
          Tenants
        </h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {tiles.map((tile) => (
            <TenantTile key={tile.tenantId} tile={tile} />
          ))}
          {tiles.length === 0 ? (
            <p className="text-[13px] text-muted">No active tenants.</p>
          ) : null}
        </div>
      </section>
    </div>
  );
}

function TenantTile({ tile }: { tile: HealthTile }) {
  const [pending, startTransition] = useTransition();
  const tone = tile.tone as StatusTone;

  return (
    <div className="rounded-[4px] border border-border bg-surface p-4">
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <Link
            href={`/tenants/${tile.slug}`}
            className="block truncate font-medium hover:text-accent-strong"
          >
            {tile.tradingName}
          </Link>
          <div className="font-mono text-[11px] text-muted">{tile.slug}</div>
        </div>
        <StatusPill tone={tone} label={tile.label} />
      </div>

      <div className="mb-2">
        <div className="mb-1 text-[11px] font-semibold tracking-wide text-muted uppercase">
          Latency (recent polls)
        </div>
        <LineChart
          height={100}
          emptyText="No latency history"
          yFormat={(n) => `${Math.round(n)}ms`}
          xLabels={tile.sparkline.map((_, i) => ({
            label:
              i === 0
                ? "older"
                : i === tile.sparkline.length - 1
                  ? "now"
                  : "",
          }))}
          series={[
            {
              id: "latency",
              label: "Latency ms",
              values: tile.sparkline,
              color: "var(--primary)",
            },
          ]}
        />
      </div>

      <dl className="grid grid-cols-[1fr_auto] gap-y-1 text-[12px]">
        <dt className="text-muted">Latency</dt>
        <dd className="font-mono tabular-nums">
          {tile.latencyMs !== null ? `${tile.latencyMs} ms` : "—"}
        </dd>
        <dt className="text-muted">Cert</dt>
        <dd className="font-mono tabular-nums">
          {tile.certDays !== null ? `${tile.certDays}d` : "—"}
        </dd>
        <dt className="text-muted">Last order</dt>
        <dd className="font-mono text-[11px]">
          {!tile.expectsOrders
            ? "n/a"
            : tile.lastOrderAt
              ? formatSastDateTime(tile.lastOrderAt)
              : "—"}
        </dd>
        <dt className="text-muted">Checked</dt>
        <dd className="font-mono text-[11px]">
          {tile.checkedAt ? formatSastDateTime(tile.checkedAt) : "—"}
        </dd>
      </dl>

      {tile.openSignals.length > 0 ? (
        <p className="mt-2 text-[11px] text-status-warn">
          {tile.openSignals.join(", ")}
        </p>
      ) : null}

      {tile.silencedUntil ? (
        <p className="mt-2 text-[11px] text-muted">
          Silenced until {formatSastDateTime(tile.silencedUntil)}
        </p>
      ) : (
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            startTransition(() => {
              void silenceOneHourAction(tile.tenantId);
            })
          }
          className="mt-3 h-7 rounded-[4px] border border-border px-2 text-[11px] hover:border-primary-light disabled:opacity-60"
        >
          Silence for 1 hour
        </button>
      )}
    </div>
  );
}
