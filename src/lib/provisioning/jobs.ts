import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { execute, query, withTransaction } from "@/lib/db/pool";
import type {
  EnqueueProvisioningJobInput,
  ProvisioningJob,
  ProvisioningJobStatus,
  ProvisioningNonSensitiveConfig,
} from "@/lib/provisioning/types";

type JobRow = RowDataPacket & {
  id: number;
  tenant_id: string;
  tier: string;
  domain: string;
  db_name: string;
  target_server_id: number;
  status: string;
  created_by: number;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  log_text: string | null;
  non_sensitive_config: unknown;
};

function parseConfig(raw: unknown): ProvisioningNonSensitiveConfig | null {
  if (raw == null) return null;
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as ProvisioningNonSensitiveConfig;
    } catch {
      return null;
    }
  }
  if (typeof raw === "object") {
    return raw as ProvisioningNonSensitiveConfig;
  }
  return null;
}

function mapRow(row: JobRow): ProvisioningJob {
  return {
    id: Number(row.id),
    tenant_id: String(row.tenant_id),
    tier: row.tier as ProvisioningJob["tier"],
    domain: String(row.domain),
    db_name: String(row.db_name),
    target_server_id: Number(row.target_server_id),
    status: row.status as ProvisioningJobStatus,
    created_by: Number(row.created_by),
    created_at: String(row.created_at),
    started_at: row.started_at == null ? null : String(row.started_at),
    finished_at: row.finished_at == null ? null : String(row.finished_at),
    log_text: row.log_text == null ? null : String(row.log_text),
    non_sensitive_config: parseConfig(row.non_sensitive_config),
  };
}

const JOB_SELECT = `SELECT id, tenant_id, tier, domain, db_name, target_server_id, status,
       created_by, created_at, started_at, finished_at, log_text,
       non_sensitive_config
     FROM provisioning_jobs`;

/** Enqueue a job. Never accepts secrets. */
export async function enqueueProvisioningJob(
  input: EnqueueProvisioningJobInput,
): Promise<number> {
  const tenantId = input.tenantId.trim().toLowerCase();
  const domain = input.domain
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/$/, "");
  const dbName = input.dbName.trim();
  const targetServerId = Number(input.targetServerId);

  if (!/^[a-z][a-z0-9-]{0,31}$/.test(tenantId)) {
    throw new Error(`Invalid tenant id: ${input.tenantId}`);
  }
  if (!domain || !domain.includes(".")) {
    throw new Error(`Invalid domain: ${input.domain}`);
  }
  if (!dbName) throw new Error("dbName is required");
  if (!Number.isFinite(targetServerId) || targetServerId <= 0) {
    throw new Error("targetServerId is required");
  }

  const result = await execute(
    `INSERT INTO provisioning_jobs
       (tenant_id, tier, domain, db_name, target_server_id, status, created_by,
        non_sensitive_config)
     VALUES
       (:tenantId, :tier, :domain, :dbName, :targetServerId, 'queued', :createdBy,
        CAST(:config AS JSON))`,
    {
      tenantId,
      tier: input.tier,
      domain,
      dbName,
      targetServerId,
      createdBy: input.createdBy,
      config: JSON.stringify(input.config ?? {}),
    },
  );
  return Number(result.insertId);
}

export async function getProvisioningJob(
  id: number,
): Promise<ProvisioningJob | null> {
  const rows = await query<JobRow[]>(
    `${JOB_SELECT} WHERE id = :id LIMIT 1`,
    { id },
  );
  return rows[0] ? mapRow(rows[0]) : null;
}

export async function listProvisioningJobs(limit = 50): Promise<ProvisioningJob[]> {
  const rows = await query<JobRow[]>(
    `${JOB_SELECT} ORDER BY id DESC LIMIT :limit`,
    { limit },
  );
  return rows.map(mapRow);
}

/**
 * Re-queue jobs stuck in `running` longer than `staleMinutes` for this server only.
 * (worker crash / reboot). Returns number of rows reclaimed.
 */
export async function reclaimStaleRunningJobs(
  staleMinutes: number,
  targetServerId: number,
): Promise<number> {
  const mins = Math.max(1, Math.floor(staleMinutes));
  const serverId = Number(targetServerId);
  if (!Number.isFinite(serverId) || serverId <= 0) {
    throw new Error("targetServerId is required to reclaim stale jobs");
  }
  const note =
    `\n[${new Date().toISOString()}] worker: reclaimed stale running job ` +
    `(>${mins} min, server #${serverId})\n`;
  const result = await execute(
    `UPDATE provisioning_jobs
     SET status = 'queued',
         started_at = NULL,
         log_text = CONCAT(COALESCE(log_text, ''), :note)
     WHERE status = 'running'
       AND target_server_id = :serverId
       AND started_at IS NOT NULL
       AND started_at < UTC_TIMESTAMP(3) - INTERVAL ${mins} MINUTE`,
    { note, serverId },
  );
  return Number(result.affectedRows ?? 0);
}

/**
 * Atomically claim the oldest queued job for this server.
 * Uses FOR UPDATE SKIP LOCKED so multiple workers cannot double-claim.
 */
export async function claimNextQueuedJob(
  targetServerId: number,
): Promise<ProvisioningJob | null> {
  const serverId = Number(targetServerId);
  if (!Number.isFinite(serverId) || serverId <= 0) {
    throw new Error("targetServerId is required to claim jobs");
  }

  return withTransaction(async (conn) => {
    const [rows] = await conn.execute<JobRow[]>(
      `${JOB_SELECT}
       WHERE status = 'queued'
         AND target_server_id = :serverId
       ORDER BY id ASC
       LIMIT 1
       FOR UPDATE SKIP LOCKED`,
      { serverId },
    );
    const row = rows[0];
    if (!row) return null;

    await conn.execute<ResultSetHeader>(
      `UPDATE provisioning_jobs
       SET status = 'running',
           started_at = UTC_TIMESTAMP(3),
           finished_at = NULL
       WHERE id = :id
         AND status = 'queued'
         AND target_server_id = :serverId`,
      { id: row.id, serverId },
    );

    const [fresh] = await conn.execute<JobRow[]>(
      `${JOB_SELECT} WHERE id = :id LIMIT 1`,
      { id: row.id },
    );
    return fresh[0] ? mapRow(fresh[0]) : null;
  });
}

/** Append a log chunk (step output). Truncates if approaching MEDIUMTEXT. */
export async function appendProvisioningJobLog(
  jobId: number,
  chunk: string,
): Promise<void> {
  const text = chunk.endsWith("\n") ? chunk : `${chunk}\n`;
  await execute(
    `UPDATE provisioning_jobs
     SET log_text = LEFT(
       CONCAT(COALESCE(log_text, ''), :chunk),
       14000000
     )
     WHERE id = :id`,
    { id: jobId, chunk: text },
  );
}

export async function finishProvisioningJob(
  jobId: number,
  status: Extract<
    ProvisioningJobStatus,
    "awaiting_env" | "succeeded" | "failed"
  >,
  finalLogLine?: string,
  meta?: {
    failedStep?: string | null;
    orphanNotes?: string | null;
  },
): Promise<void> {
  if (finalLogLine?.trim()) {
    await appendProvisioningJobLog(jobId, finalLogLine);
  }

  const job = await getProvisioningJob(jobId);
  const cfg: ProvisioningNonSensitiveConfig = {
    ...(job?.non_sensitive_config ?? {}),
    lastOutcome: status,
    failedStep: status === "failed" ? (meta?.failedStep ?? null) : null,
    orphanNotes: status === "failed" ? (meta?.orphanNotes ?? null) : null,
  };

  await execute(
    `UPDATE provisioning_jobs
     SET status = :status,
         finished_at = UTC_TIMESTAMP(3),
         non_sensitive_config = CAST(:config AS JSON)
     WHERE id = :id AND status = 'running'`,
    { id: jobId, status, config: JSON.stringify(cfg) },
  );
}

/** Re-queue a failed job for an idempotent retry (super-admin action). */
export async function requeueFailedProvisioningJob(
  jobId: number,
): Promise<ProvisioningJob> {
  const job = await getProvisioningJob(jobId);
  if (!job) throw new Error("Job not found");
  if (job.status !== "failed") {
    throw new Error(`Only failed jobs can be retried (status=${job.status})`);
  }

  const cfg: ProvisioningNonSensitiveConfig = {
    ...(job.non_sensitive_config ?? {}),
    retryCount: (job.non_sensitive_config?.retryCount ?? 0) + 1,
    failedStep: null,
    orphanNotes: null,
    lastOutcome: null,
  };

  const note =
    `\n[${new Date().toISOString()}] retry #${cfg.retryCount} queued ` +
    `(idempotent re-run — will reuse DB/.env when present)\n`;

  await execute(
    `UPDATE provisioning_jobs
     SET status = 'queued',
         started_at = NULL,
         finished_at = NULL,
         non_sensitive_config = CAST(:config AS JSON),
         log_text = CONCAT(COALESCE(log_text, ''), :note)
     WHERE id = :id AND status = 'failed'`,
    { id: jobId, config: JSON.stringify(cfg), note },
  );

  const fresh = await getProvisioningJob(jobId);
  if (!fresh) throw new Error("Job disappeared after requeue");
  return fresh;
}
