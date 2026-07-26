import type { RowDataPacket } from "mysql2/promise";
import { execute, query } from "@/lib/db/pool";
import { applySignalEvaluations } from "@/lib/health/alerts";
import { pollTenant, type TenantProbeTarget } from "@/lib/health/probe";
import {
  evaluateSignals,
  recentChecksFromRows,
} from "@/lib/health/signals";
import { HEALTH_RETENTION_DAYS } from "@/lib/health/types";

export async function listActiveProbeTargets(): Promise<TenantProbeTarget[]> {
  const rows = await query<
    (RowDataPacket & {
      id: number;
      slug: string;
      primary_domain: string;
      health_path: string;
      fleet_secret: string;
      plan_code: string | null;
    })[]
  >(
    `SELECT t.id, t.slug, i.primary_domain, i.health_path, i.fleet_secret,
            (
              SELECT s.plan_code FROM subscriptions s
              WHERE s.tenant_id = t.id AND s.status = 'active'
              ORDER BY s.id DESC LIMIT 1
            ) AS plan_code
     FROM tenants t
     INNER JOIN tenant_infra i ON i.tenant_id = t.id
     WHERE t.status = 'active'
     ORDER BY t.slug`,
  );
  return rows.map((r) => ({
    id: Number(r.id),
    slug: r.slug,
    primaryDomain: r.primary_domain,
    healthPath: r.health_path || "/api/_fleet/health",
    fleetSecretCipher: r.fleet_secret,
    planCode: r.plan_code ? String(r.plan_code) : null,
  }));
}

export async function storeHealthCheck(poll: {
  tenantId: number;
  ok: boolean;
  latencyMs: number | null;
  certDaysRemaining: number | null;
  httpsOk: boolean;
  fleetOk: boolean;
  payload: unknown;
  error: string | null;
}): Promise<number> {
  const result = await execute(
    `INSERT INTO health_checks
       (tenant_id, checked_at, ok, latency_ms, cert_days_remaining,
        https_ok, fleet_ok, payload, error)
     VALUES (:tenantId, UTC_TIMESTAMP(3), :ok, :latencyMs, :certDays,
             :httpsOk, :fleetOk, CAST(:payload AS JSON), :error)`,
    {
      tenantId: poll.tenantId,
      ok: poll.ok ? 1 : 0,
      latencyMs: poll.latencyMs,
      certDays: poll.certDaysRemaining,
      httpsOk: poll.httpsOk ? 1 : 0,
      fleetOk: poll.fleetOk ? 1 : 0,
      payload: poll.payload ? JSON.stringify(poll.payload) : null,
      error: poll.error,
    },
  );
  return Number(result.insertId);
}

export async function loadRecentChecks(
  tenantId: number,
  limit = 10,
): Promise<
  (RowDataPacket & {
    ok: number;
    latency_ms: number | null;
    payload: unknown;
    checked_at: string;
  })[]
> {
  return query(
    `SELECT ok, latency_ms, payload, checked_at
     FROM health_checks
     WHERE tenant_id = :tenantId
     ORDER BY checked_at DESC
     LIMIT ${limit}`,
    { tenantId },
  );
}

export async function pruneOldHealthChecks(): Promise<number> {
  const result = await execute(
    `DELETE FROM health_checks
     WHERE checked_at < DATE_SUB(UTC_TIMESTAMP(3), INTERVAL :days DAY)`,
    { days: HEALTH_RETENTION_DAYS },
  );
  return result.affectedRows;
}

export type PollRunSummary = {
  tenants: number;
  healthy: number;
  failed: number;
  pruned: number;
  errors: string[];
};

/** Poll every active tenant, store checks, evaluate signals, prune. */
export async function runHealthPollCycle(): Promise<PollRunSummary> {
  const targets = await listActiveProbeTargets();
  const summary: PollRunSummary = {
    tenants: targets.length,
    healthy: 0,
    failed: 0,
    pruned: 0,
    errors: [],
  };

  for (const target of targets) {
    try {
      const recentRows = await loadRecentChecks(target.id, 30);
      const recent = recentChecksFromRows(recentRows);

      const poll = await pollTenant(target);
      await storeHealthCheck({
        tenantId: poll.tenantId,
        ok: poll.ok,
        latencyMs: poll.latencyMs,
        certDaysRemaining: poll.certDaysRemaining,
        httpsOk: poll.httpsOk,
        fleetOk: poll.fleetOk,
        payload: poll.payload,
        error: poll.error,
      });

      if (poll.ok) summary.healthy++;
      else summary.failed++;

      const evaluations = evaluateSignals(poll, recent);
      await applySignalEvaluations({
        tenantId: poll.tenantId,
        slug: poll.slug,
        evaluations,
      });
    } catch (err) {
      summary.failed++;
      summary.errors.push(
        `${target.slug}: ${err instanceof Error ? err.message : "poll failed"}`,
      );
    }
  }

  try {
    summary.pruned = await pruneOldHealthChecks();
  } catch (err) {
    summary.errors.push(
      `prune: ${err instanceof Error ? err.message : "failed"}`,
    );
  }

  return summary;
}
