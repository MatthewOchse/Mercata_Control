export type AlertSignal =
  | "site_down"
  | "db_unreachable"
  | "cert_expiring"
  | "slow"
  | "pending_migrations"
  | "sales_silence";

export type AlertSeverity = "critical" | "warning";

export const SIGNAL_SEVERITY: Record<AlertSignal, AlertSeverity> = {
  site_down: "critical",
  db_unreachable: "critical",
  cert_expiring: "warning",
  slow: "warning",
  pending_migrations: "warning",
  sales_silence: "warning",
};

export const SIGNAL_LABEL: Record<AlertSignal, string> = {
  site_down: "Site down",
  db_unreachable: "Database unreachable",
  cert_expiring: "Certificate expiring",
  slow: "Slow responses",
  pending_migrations: "Pending migrations",
  sales_silence: "Sales silence",
};

export const DEFAULT_COOLDOWN_HOURS = 6;
export const CERT_WARN_DAYS = 14;
export const SLOW_MS = 3000;
export const SLOW_CONSECUTIVE = 3;
export const SITE_DOWN_CONSECUTIVE = 2;
export const SALES_SILENCE_DAYS = 7;
export const HEALTH_RETENTION_DAYS = 30;

export type FleetHealthPayload = {
  contract?: number;
  tenant?: string;
  status?: string;
  app?: { version?: string; uptime_s?: number };
  db?: {
    reachable?: boolean;
    latency_ms?: number;
    pending_migrations?: number;
  };
  storefront?: {
    products_visible?: number;
    last_order_at?: string | null;
  };
};

export type PollResult = {
  tenantId: number;
  slug: string;
  /** Active plan code when known (e.g. service_hosting has no store orders). */
  planCode: string | null;
  ok: boolean;
  latencyMs: number | null;
  certDaysRemaining: number | null;
  httpsOk: boolean;
  fleetOk: boolean;
  payload: FleetHealthPayload | null;
  error: string | null;
};

/** Plans that never have commerce orders — skip sales_silence. */
export function planExpectsOrders(planCode: string | null | undefined): boolean {
  if (!planCode) return true;
  return planCode !== "service_hosting";
}

/**
 * Retail storefronts expose /api/_fleet/health. Sites (brochure) deploys do not —
 * probing the fleet endpoint there always 404s and falsely raises site_down.
 */
export function planExpectsFleetHealth(
  planCode: string | null | undefined,
): boolean {
  return planExpectsOrders(planCode);
}
