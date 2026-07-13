import type { RowDataPacket } from "mysql2/promise";
import { query } from "@/lib/db/pool";
import {
  SIGNAL_LABEL,
  type AlertSignal,
  type FleetHealthPayload,
} from "@/lib/health/types";

export type HealthTile = {
  tenantId: number;
  slug: string;
  tradingName: string;
  tone: "ok" | "warn" | "error" | "idle";
  label: string;
  latencyMs: number | null;
  certDays: number | null;
  lastOrderAt: string | null;
  checkedAt: string | null;
  sparkline: number[];
  openSignals: string[];
  silencedUntil: string | null;
};

export type IncidentRow = {
  tenantId: number;
  slug: string;
  tradingName: string;
  signal: AlertSignal;
  label: string;
  severity: "critical" | "warning";
  openedAt: string | null;
  details: unknown;
};

function parsePayload(raw: unknown): FleetHealthPayload | null {
  if (!raw) return null;
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as FleetHealthPayload;
    } catch {
      return null;
    }
  }
  return raw as FleetHealthPayload;
}

function tileTone(
  openCritical: boolean,
  openWarning: boolean,
  hasCheck: boolean,
  ok: boolean | null,
): { tone: HealthTile["tone"]; label: string } {
  if (!hasCheck) return { tone: "idle", label: "Not checked" };
  if (openCritical || ok === false) return { tone: "error", label: "Down" };
  if (openWarning) return { tone: "warn", label: "Degraded" };
  return { tone: "ok", label: "Healthy" };
}

export async function getHealthDashboard(): Promise<{
  tiles: HealthTile[];
  incidents: IncidentRow[];
}> {
  const tenants = await query<
    (RowDataPacket & {
      id: number;
      slug: string;
      trading_name: string;
    })[]
  >(
    `SELECT id, slug, trading_name FROM tenants
     WHERE status IN ('active', 'suspended')
     ORDER BY trading_name`,
  );

  const openAlerts = await query<
    (RowDataPacket & {
      tenant_id: number;
      signal: string;
      severity: "critical" | "warning";
      opened_at: string | null;
      details: unknown;
      slug: string;
      trading_name: string;
    })[]
  >(
    "SELECT a.tenant_id, a.`signal`, a.severity, a.opened_at, a.details, t.slug, t.trading_name FROM alert_states a INNER JOIN tenants t ON t.id = a.tenant_id WHERE a.status = 'open' ORDER BY FIELD(a.severity, 'critical', 'warning'), a.opened_at ASC",
  );

  const incidents: IncidentRow[] = openAlerts.map((a) => ({
    tenantId: Number(a.tenant_id),
    slug: a.slug,
    tradingName: a.trading_name,
    signal: a.signal as AlertSignal,
    label: SIGNAL_LABEL[a.signal as AlertSignal] ?? a.signal,
    severity: a.severity,
    openedAt: a.opened_at ? String(a.opened_at) : null,
    details: a.details,
  }));

  const openByTenant = new Map<number, typeof openAlerts>();
  for (const a of openAlerts) {
    const id = Number(a.tenant_id);
    const list = openByTenant.get(id) ?? [];
    list.push(a);
    openByTenant.set(id, list);
  }

  const tiles: HealthTile[] = [];

  for (const t of tenants) {
    const tenantId = Number(t.id);
    const latest = await query<
      (RowDataPacket & {
        ok: number;
        latency_ms: number | null;
        cert_days_remaining: number | null;
        payload: unknown;
        checked_at: string;
      })[]
    >(
      `SELECT ok, latency_ms, cert_days_remaining, payload, checked_at
       FROM health_checks WHERE tenant_id = :tenantId
       ORDER BY checked_at DESC LIMIT 1`,
      { tenantId },
    );
    const sparkRows = await query<
      (RowDataPacket & { latency_ms: number | null })[]
    >(
      `SELECT latency_ms FROM health_checks
       WHERE tenant_id = :tenantId AND latency_ms IS NOT NULL
       ORDER BY checked_at DESC LIMIT 24`,
      { tenantId },
    );
    const silence = await query<(RowDataPacket & { ends_at: string })[]>(
      `SELECT ends_at FROM maintenance_windows
       WHERE tenant_id = :tenantId
         AND starts_at <= UTC_TIMESTAMP(3)
         AND ends_at > UTC_TIMESTAMP(3)
       ORDER BY ends_at DESC LIMIT 1`,
      { tenantId },
    );

    const check = latest[0];
    const payload = parsePayload(check?.payload);
    const opens = openByTenant.get(tenantId) ?? [];
    const { tone, label } = tileTone(
      opens.some((o) => o.severity === "critical"),
      opens.some((o) => o.severity === "warning"),
      Boolean(check),
      check ? Boolean(check.ok) : null,
    );

    tiles.push({
      tenantId,
      slug: t.slug,
      tradingName: t.trading_name,
      tone,
      label,
      latencyMs: check?.latency_ms === null || check?.latency_ms === undefined
        ? null
        : Number(check.latency_ms),
      certDays:
        check?.cert_days_remaining === null ||
        check?.cert_days_remaining === undefined
          ? null
          : Number(check.cert_days_remaining),
      lastOrderAt: payload?.storefront?.last_order_at ?? null,
      checkedAt: check?.checked_at ? String(check.checked_at) : null,
      sparkline: sparkRows
        .map((r) => Number(r.latency_ms))
        .filter((n) => Number.isFinite(n))
        .reverse(),
      openSignals: opens.map((o) => o.signal),
      silencedUntil: silence[0]?.ends_at
        ? String(silence[0].ends_at)
        : null,
    });
  }

  return { tiles, incidents };
}
