/** Provisioning job statuses — host-scoped worker drives the state machine. */
export const PROVISIONING_JOB_STATUSES = [
  "queued",
  "running",
  "awaiting_env",
  "succeeded",
  "failed",
] as const;

export type ProvisioningJobStatus = (typeof PROVISIONING_JOB_STATUSES)[number];

export type ProvisioningTier = "online" | "retail";

/**
 * Extra options stored on the job. Must never contain secrets
 * (no FLEET_SECRET, DB passwords, PayFast keys, etc.).
 */
export type ProvisioningNonSensitiveConfig = {
  displayName?: string;
  /** Target box name (matches servers.name), e.g. caesar — informational. */
  host?: string;
  adminUsername?: string;
  /** When true, worker skips fleet:generate (operator will run it). */
  skipDeployGenerate?: boolean;
  notes?: string;
  /** Last failing step name (e.g. "3: provision DB") — never secrets. */
  failedStep?: string | null;
  /** Human notes about leftover DB/container after failure. */
  orphanNotes?: string | null;
  /** Last terminal outcome recorded by the worker. */
  lastOutcome?: "succeeded" | "failed" | "awaiting_env" | null;
  retryCount?: number;
};

export type ProvisioningJob = {
  id: number;
  tenant_id: string;
  tier: ProvisioningTier;
  domain: string;
  db_name: string;
  /** FK to servers.id — only that box's worker may claim this job. */
  target_server_id: number;
  status: ProvisioningJobStatus;
  created_by: number;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  log_text: string | null;
  non_sensitive_config: ProvisioningNonSensitiveConfig | null;
};

export type EnqueueProvisioningJobInput = {
  tenantId: string;
  tier: ProvisioningTier;
  domain: string;
  dbName: string;
  /** Required: which Server worker will run this job. */
  targetServerId: number;
  createdBy: number;
  config?: ProvisioningNonSensitiveConfig | null;
};
