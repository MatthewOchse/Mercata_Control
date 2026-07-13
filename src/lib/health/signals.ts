import type { RowDataPacket } from "mysql2/promise";
import {
  CERT_WARN_DAYS,
  SALES_SILENCE_DAYS,
  SIGNAL_SEVERITY,
  SITE_DOWN_CONSECUTIVE,
  SLOW_CONSECUTIVE,
  SLOW_MS,
  type AlertSignal,
  type FleetHealthPayload,
  type PollResult,
} from "@/lib/health/types";

export type SignalEvaluation = {
  signal: AlertSignal;
  active: boolean;
  detail: Record<string, unknown>;
};

type RecentCheck = {
  ok: boolean;
  latency_ms: number | null;
  payload: FleetHealthPayload | null;
  checked_at: string;
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

export function evaluateSignals(
  poll: PollResult,
  recent: RecentCheck[],
): SignalEvaluation[] {
  // recent is newest-first, excluding the poll just stored (or including — we pass history before current)
  const withCurrent: RecentCheck[] = [
    {
      ok: poll.ok,
      latency_ms: poll.latencyMs,
      payload: poll.payload,
      checked_at: new Date().toISOString(),
    },
    ...recent,
  ];

  const signals: SignalEvaluation[] = [];

  // site_down — 2 consecutive failed polls
  const lastN = withCurrent.slice(0, SITE_DOWN_CONSECUTIVE);
  const siteDown =
    lastN.length >= SITE_DOWN_CONSECUTIVE && lastN.every((c) => !c.ok);
  signals.push({
    signal: "site_down",
    active: siteDown,
    detail: {
      consecutive_failures: lastN.filter((c) => !c.ok).length,
      error: poll.error,
    },
  });

  // db_unreachable — from health payload
  const dbReachable = poll.payload?.db?.reachable;
  const dbUnreachable = poll.fleetOk && dbReachable === false;
  signals.push({
    signal: "db_unreachable",
    active: Boolean(dbUnreachable),
    detail: { db: poll.payload?.db ?? null },
  });

  // cert_expiring — fewer than 14 days
  const certDays = poll.certDaysRemaining;
  const certExpiring =
    certDays !== null && certDays < CERT_WARN_DAYS;
  signals.push({
    signal: "cert_expiring",
    active: certExpiring,
    detail: { cert_days_remaining: certDays },
  });

  // slow — response time above 3s across 3 consecutive polls
  const lastSlow = withCurrent.slice(0, SLOW_CONSECUTIVE);
  const slow =
    lastSlow.length >= SLOW_CONSECUTIVE &&
    lastSlow.every(
      (c) => c.latency_ms !== null && c.latency_ms > SLOW_MS,
    );
  signals.push({
    signal: "slow",
    active: slow,
    detail: {
      latencies_ms: lastSlow.map((c) => c.latency_ms),
      threshold_ms: SLOW_MS,
    },
  });

  // pending_migrations — non-zero
  const pending = Number(poll.payload?.db?.pending_migrations ?? 0);
  signals.push({
    signal: "pending_migrations",
    active: pending > 0,
    detail: { pending_migrations: pending },
  });

  // sales_silence — no order in 7 days for a tenant that normally has them
  signals.push(evaluateSalesSilence(poll, withCurrent));

  void SIGNAL_SEVERITY;
  return signals;
}

function evaluateSalesSilence(
  poll: PollResult,
  history: RecentCheck[],
): SignalEvaluation {
  const lastOrderAt = poll.payload?.storefront?.last_order_at ?? null;
  if (!lastOrderAt) {
    return {
      signal: "sales_silence",
      active: false,
      detail: { reason: "no_last_order_at" },
    };
  }

  const lastOrder = new Date(lastOrderAt).getTime();
  if (Number.isNaN(lastOrder)) {
    return {
      signal: "sales_silence",
      active: false,
      detail: { reason: "invalid_last_order_at" },
    };
  }

  const silenceMs = Date.now() - lastOrder;
  const silenceDays = silenceMs / (1000 * 60 * 60 * 24);
  const currentlySilent = silenceDays >= SALES_SILENCE_DAYS;

  // Baseline: did this tenant show fresh orders in the last 30 days of checks?
  // A check counts as "normally has orders" if at check time last_order_at was < 7 days old.
  let hadActiveBaseline = false;
  for (const check of history) {
    const lo = check.payload?.storefront?.last_order_at;
    if (!lo) continue;
    const orderTs = new Date(lo).getTime();
    const checkTs = new Date(check.checked_at).getTime();
    if (Number.isNaN(orderTs) || Number.isNaN(checkTs)) continue;
    const ageDays = (checkTs - orderTs) / (1000 * 60 * 60 * 24);
    if (ageDays >= 0 && ageDays < SALES_SILENCE_DAYS) {
      hadActiveBaseline = true;
      break;
    }
  }

  return {
    signal: "sales_silence",
    active: currentlySilent && hadActiveBaseline,
    detail: {
      last_order_at: lastOrderAt,
      silence_days: Math.floor(silenceDays),
      had_active_baseline: hadActiveBaseline,
    },
  };
}

export function recentChecksFromRows(
  rows: (RowDataPacket & {
    ok: number;
    latency_ms: number | null;
    payload: unknown;
    checked_at: Date | string;
  })[],
): RecentCheck[] {
  return rows.map((r) => ({
    ok: Boolean(r.ok),
    latency_ms: r.latency_ms === null ? null : Number(r.latency_ms),
    payload: parsePayload(r.payload),
    checked_at:
      typeof r.checked_at === "string"
        ? r.checked_at
        : r.checked_at.toISOString(),
  }));
}
