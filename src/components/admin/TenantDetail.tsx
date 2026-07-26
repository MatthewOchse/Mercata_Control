"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Money } from "@/components/ui/status";
import {
  DEFAULT_DETAIL_RANGE,
  isDetailRange,
  type DetailRange,
} from "@/lib/analytics/detail-range";
import {
  LineChart,
  shortDateLabel,
} from "@/components/charts/LineChart";
import type { CommerceResult } from "@/lib/tenants/commerce";
import type { Standing } from "@/lib/tenants/standing";

export type TenantDetailOption = {
  id: number;
  slug: string;
  tradingName: string;
};

type ColumnResult<T> = {
  data: T | null;
  error: string | null;
  code?: string;
};

type TrafficOverview = {
  activeUsers: number;
  sessions: number;
  screenPageViews: number;
  avgSessionDuration: number;
  series: { date: string; users: number; sessions: number }[];
  topPages: { path: string; views: number }[];
  topSources: { source: string; sessions: number }[];
  source: "warehouse" | "live";
};

type DetailResponse = {
  tenant: {
    id: number;
    slug: string;
    name: string;
    domain: string | null;
    status: string;
    ga4PropertyId: string | null;
  };
  range: DetailRange;
  analytics: ColumnResult<TrafficOverview>;
  standing: ColumnResult<Standing>;
  commerce: ColumnResult<CommerceResult>;
};

const RANGE_OPTIONS: { id: DetailRange; label: string }[] = [
  { id: "1d", label: "Yesterday" },
  { id: "7d", label: "7d" },
  { id: "28d", label: "28d" },
  { id: "90d", label: "90d" },
];

function formatPeriodLabel(
  from: string,
  to: string,
  range: DetailRange,
): string {
  if (range === "1d" || from === to) return from;
  return `${from} → ${to}`;
}

function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) return "—";
  const s = Math.round(seconds);
  const m = Math.floor(s / 60);
  const r = s % 60;
  if (m <= 0) return `${r}s`;
  return `${m}m ${r}s`;
}

function standingStripClass(stage: Standing["dunningStage"] | undefined): string {
  if (!stage || stage === "current") {
    return "border-border bg-surface text-muted";
  }
  if (stage === "final" || stage === "suspend") {
    return "border-status-error bg-status-error/10 text-status-error";
  }
  return "border-accent bg-accent/15 text-primary";
}

export function TenantDetail({ tenants }: { tenants: TenantDetailOption[] }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const active = tenants.filter((t) => t.slug);

  const tenantSlug = searchParams.get("tenant") ?? active[0]?.slug ?? "";
  const rangeParam = searchParams.get("range");
  const range: DetailRange = isDetailRange(rangeParam)
    ? rangeParam
    : DEFAULT_DETAIL_RANGE;

  const selected = useMemo(
    () => active.find((t) => t.slug === tenantSlug) ?? active[0] ?? null,
    [active, tenantSlug],
  );

  const [detail, setDetail] = useState<DetailResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const setQuery = useCallback(
    (next: { tenant?: string; range?: DetailRange }) => {
      const params = new URLSearchParams(searchParams.toString());
      if (next.tenant !== undefined) params.set("tenant", next.tenant);
      if (next.range !== undefined) params.set("range", next.range);
      const qs = params.toString();
      router.replace(qs ? `/?${qs}` : "/", { scroll: false });
    },
    [router, searchParams],
  );

  useEffect(() => {
    if (!selected) return;
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    // Clear range-scoped columns immediately so filters feel instant.
    setDetail((prev) =>
      prev
        ? {
            ...prev,
            range,
            analytics: { data: null, error: null },
            commerce: { data: null, error: null },
          }
        : null,
    );
    void fetch(
      `/api/admin/tenants/${selected.id}/detail?range=${encodeURIComponent(range)}`,
    )
      .then(async (res) => {
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as {
            error?: string;
          } | null;
          throw new Error(body?.error ?? `HTTP ${res.status}`);
        }
        return res.json() as Promise<DetailResponse>;
      })
      .then((json) => {
        if (!cancelled) setDetail(json);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setDetail(null);
          setLoadError(err instanceof Error ? err.message : "Failed to load");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selected, range]);

  if (active.length === 0) return null;

  const detailFresh = detail?.range === range;
  const standing = detail?.standing.data ?? null;
  const analytics = detailFresh ? (detail?.analytics.data ?? null) : null;
  const commerce = detailFresh ? (detail?.commerce.data ?? null) : null;
  const analyticsError = detailFresh ? detail?.analytics.error : null;
  const analyticsCode = detailFresh ? detail?.analytics.code : undefined;
  const commerceError = detailFresh ? detail?.commerce.error : null;

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-display text-[18px] font-semibold text-primary">
            Tenant detail
          </h2>
          <p className="text-[12px] text-muted">
            Drill-down for one tenant — fleet view above stays unchanged.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-[11px] font-semibold tracking-wide text-muted uppercase">
            Tenant
            <select
              className="ml-2 h-8 min-w-[10rem] rounded-[4px] border border-border bg-surface px-2 text-[13px] font-normal normal-case text-primary"
              value={selected?.slug ?? ""}
              onChange={(e) => setQuery({ tenant: e.target.value })}
            >
              {active.map((t) => (
                <option key={t.id} value={t.slug}>
                  {t.tradingName}
                </option>
              ))}
            </select>
          </label>
          <div className="inline-flex rounded-[4px] border border-border bg-surface p-0.5">
            {RANGE_OPTIONS.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => setQuery({ range: r.id })}
                className={
                  range === r.id
                    ? "h-7 rounded-[3px] bg-primary px-2.5 text-[11px] font-semibold text-white"
                    : "h-7 rounded-[3px] px-2.5 text-[11px] font-semibold text-muted hover:text-primary"
                }
              >
                {r.label}
              </button>
            ))}
          </div>
          {selected ? (
            <Link
              href={`/tenants/${selected.slug}`}
              className="text-[12px] text-accent-strong hover:underline"
            >
              Full tenant →
            </Link>
          ) : null}
        </div>
      </div>

      <div
        className={`rounded-[4px] border px-3 py-2 text-[13px] ${standingStripClass(standing?.dunningStage)}`}
      >
        {loading && !standing ? (
          <span>Loading standing…</span>
        ) : detail?.standing.error ? (
          <span>{detail.standing.error}</span>
        ) : standing && standing.dunningStage === "current" && standing.balanceCents <= 0 ? (
          <span>No outstanding balance</span>
        ) : standing ? (
          <span className="font-medium tabular-nums">
            Balance <Money cents={standing.balanceCents} />
            {" · "}
            Overdue <Money cents={standing.overdueCents} />
            {" · "}
            {standing.oldestOverdueDays == null
              ? "0 days"
              : `${standing.oldestOverdueDays} days`}
            {" · "}
            Stage {standing.dunningStage}
          </span>
        ) : (
          <span>—</span>
        )}
      </div>

      {loadError ? (
        <p className="text-[12px] text-status-error">{loadError}</p>
      ) : null}

      <div className="grid gap-3 lg:grid-cols-3">
        <article className="rounded-[4px] border border-border bg-surface p-4">
          <h3 className="mb-3 text-[12px] font-semibold tracking-wide text-muted uppercase">
            Traffic
          </h3>
          {loading || !detailFresh ? (
            <p className="text-[12px] text-muted">Loading…</p>
          ) : analyticsError ? (
            <p className="text-[12px] text-status-warn">
              {analyticsError}
              {analyticsCode === "ga4_not_configured" ? (
                <>
                  {" "}
                  <Link
                    href={`/tenants/${selected?.slug}?tab=digest`}
                    className="text-accent-strong hover:underline"
                  >
                    Open Digest settings
                  </Link>
                </>
              ) : null}
            </p>
          ) : analytics ? (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <Stat label="Users" value={analytics.activeUsers} />
                <Stat label="Sessions" value={analytics.sessions} />
                <Stat label="Pageviews" value={analytics.screenPageViews} />
                <Stat
                  label="Avg duration"
                  value={formatDuration(
                    analytics.source === "warehouse"
                      ? null
                      : analytics.avgSessionDuration,
                  )}
                />
              </div>
              <Sparkline
                series={analytics.series.map((s) => ({
                  date: s.date,
                  value: s.sessions,
                }))}
              />
              <CompactList
                title="Top pages"
                rows={analytics.topPages.map((p) => ({
                  label: p.path,
                  value: String(p.views),
                }))}
              />
              <CompactList
                title="Top sources"
                rows={analytics.topSources.map((s) => ({
                  label: s.source,
                  value: String(s.sessions),
                }))}
              />
            </div>
          ) : (
            <p className="text-[12px] text-muted">No traffic data</p>
          )}
        </article>

        <article className="rounded-[4px] border border-border bg-surface p-4">
          <h3 className="mb-3 text-[12px] font-semibold tracking-wide text-muted uppercase">
            Account
          </h3>
          {loading && !standing && !detail?.standing.error ? (
            <p className="text-[12px] text-muted">Loading…</p>
          ) : detail?.standing.error ? (
            <p className="text-[12px] text-status-warn">{detail.standing.error}</p>
          ) : standing ? (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <div className="text-[11px] font-semibold tracking-wide text-muted uppercase">
                    MRR
                  </div>
                  <div className="mt-0.5 font-mono text-[15px] font-semibold tabular-nums">
                    <Money cents={standing.mrrCents} />
                  </div>
                </div>
                <div>
                  <div className="text-[11px] font-semibold tracking-wide text-muted uppercase">
                    Next bill
                  </div>
                  <div className="mt-0.5 font-mono text-[15px] tabular-nums">
                    {standing.nextBillAt ?? "—"}
                  </div>
                </div>
              </div>
              <table className="admin-table text-[12px]">
                <thead>
                  <tr>
                    <th>Invoice</th>
                    <th>Due</th>
                    <th className="text-right">Amount</th>
                    <th className="text-right">Days</th>
                  </tr>
                </thead>
                <tbody>
                  {standing.invoices.map((inv, i) => (
                    <tr key={`${inv.number}-${i}`}>
                      <td className="font-mono">{inv.number}</td>
                      <td className="font-mono text-muted">
                        {inv.dueAt ?? "—"}
                      </td>
                      <td className="text-right">
                        <Money cents={inv.amountCents} />
                      </td>
                      <td
                        className={
                          inv.daysOverdue > 0
                            ? "text-right font-semibold text-status-error"
                            : "text-right text-muted"
                        }
                      >
                        {inv.status === "paid" || inv.status === "void"
                          ? "—"
                          : inv.daysOverdue}
                      </td>
                    </tr>
                  ))}
                  {standing.invoices.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="text-muted">
                        No invoices yet
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          ) : null}
        </article>

        <article className="rounded-[4px] border border-border bg-surface p-4">
          <h3 className="mb-3 text-[12px] font-semibold tracking-wide text-muted uppercase">
            Commerce
          </h3>
          {loading || !detailFresh ? (
            <p className="text-[12px] text-muted">Loading…</p>
          ) : commerceError ? (
            <p className="text-[12px] text-status-warn">{commerceError}</p>
          ) : commerce?.kind === "sites" ? (
            <p className="text-[12px] text-muted">
              Sites tenant — no commerce data
            </p>
          ) : commerce?.kind === "shop" ? (
            <div className="space-y-3">
              <p className="text-[11px] text-muted">
                {commerce.periodComplete
                  ? `Net sales · ${formatPeriodLabel(commerce.periodFrom, commerce.periodTo, commerce.range)}`
                  : `Warehouse partial · ${formatPeriodLabel(commerce.periodFrom, commerce.periodTo, commerce.range)}`}
              </p>
              <div className="grid grid-cols-2 gap-2">
                <Stat label="Orders" value={commerce.orders} />
                <div>
                  <div className="text-[11px] font-semibold tracking-wide text-muted uppercase">
                    Net sales
                  </div>
                  <div className="mt-0.5 font-mono text-[15px] font-semibold tabular-nums">
                    <Money cents={commerce.netSalesCents} />
                  </div>
                </div>
                {commerce.eventsGrossCents != null &&
                commerce.eventsGrossCents > 0 ? (
                  <>
                    <Stat
                      label="Event bookings"
                      value={commerce.eventsBookingsCount ?? 0}
                    />
                    <div>
                      <div className="text-[11px] font-semibold tracking-wide text-muted uppercase">
                        Events revenue
                      </div>
                      <div className="mt-0.5 font-mono text-[15px] font-semibold tabular-nums text-accent-strong">
                        <Money cents={commerce.eventsGrossCents} />
                      </div>
                      {commerce.eventsSpaces != null &&
                      commerce.eventsSpaces > 0 ? (
                        <div className="mt-0.5 text-[10px] text-muted">
                          {commerce.eventsSpaces} space
                          {commerce.eventsSpaces === 1 ? "" : "s"}
                        </div>
                      ) : null}
                    </div>
                  </>
                ) : null}
                <Stat
                  label="Listed on site"
                  value={
                    commerce.productsListed == null
                      ? "—"
                      : commerce.productsListed
                  }
                />
                <div>
                  <div className="text-[11px] font-semibold tracking-wide text-muted uppercase">
                    Last order
                  </div>
                  <div className="mt-0.5 font-mono text-[13px] tabular-nums">
                    {commerce.lastOrderAt
                      ? String(commerce.lastOrderAt)
                          .replace("T", " ")
                          .slice(0, 19)
                      : "—"}
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <p className="text-[12px] text-muted">No commerce data</p>
          )}
        </article>
      </div>
    </section>
  );
}

function Stat({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div>
      <div className="text-[11px] font-semibold tracking-wide text-muted uppercase">
        {label}
      </div>
      <div className="mt-0.5 font-mono text-[15px] font-semibold tabular-nums">
        {value}
      </div>
    </div>
  );
}

function Sparkline({
  series,
}: {
  series: Array<{ date: string; value: number }>;
}) {
  return (
    <LineChart
      height={120}
      emptyText="No traffic series"
      xLabels={series.map((s) => ({ label: shortDateLabel(s.date) }))}
      series={[
        {
          id: "sessions",
          label: "Sessions",
          values: series.map((s) => s.value),
          color: "var(--primary)",
        },
      ]}
    />
  );
}

function CompactList({
  title,
  rows,
}: {
  title: string;
  rows: Array<{ label: string; value: string }>;
}) {
  return (
    <div>
      <div className="mb-1 text-[11px] font-semibold tracking-wide text-muted uppercase">
        {title}
      </div>
      {rows.length === 0 ? (
        <p className="text-[12px] text-muted">—</p>
      ) : (
        <ul className="space-y-0.5">
          {rows.slice(0, 6).map((r) => (
            <li
              key={r.label}
              className="flex justify-between gap-2 text-[12px]"
            >
              <span className="truncate text-primary">{r.label}</span>
              <span className="shrink-0 font-mono tabular-nums text-muted">
                {r.value}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
