/**
 * Secure one-time hand-off of EXTERNAL provision secrets.
 *
 * Mechanism:
 *   1. Admin form POST → server action encrypts the JSON payload with
 *      ENCRYPTION_KEY (AES-256-GCM, same as fleet_secret) via encryptSecret().
 *   2. Ciphertext is stored ONLY in provisioning_job_secrets (never in
 *      provisioning_jobs.non_sensitive_config, never in audit log, never
 *      returned to the browser).
 *   3. Host worker loads ciphertext by job_id, decrypts in-process, tracks
 *      values in SecretRedactor, writes deploy/tenants/<id>/.env.
 *      Ciphertext is DELETED only after provision succeeds (retry-safe).
 *   4. If the worker crashes mid-run, reclaim / retry can re-decrypt;
 *      ciphertext remains until success purge.
 *   5. INTERNAL secrets (AUTH/STORE_ADMIN/FLEET) are never in this table —
 *      generated on the host only.
 *
 * ENCRYPTION_KEY lives in control .env / worker .env.worker on Caesar —
 * not in the browser, not in the job log.
 */
import { decryptSecret, encryptSecret } from "@/lib/crypto/secrets";
import { execute, query } from "@/lib/db/pool";
import type { RowDataPacket } from "mysql2/promise";
import type { ExternalProvisionSecrets } from "@/lib/provisioning/secrets";
import type { SecretRedactor } from "@/lib/provisioning/redact";

export type ExternalSecretPayload = ExternalProvisionSecrets & {
  ADMIN_EMAIL?: string;
  PAYFAST_SANDBOX?: string;
  SHIPLOGIC_BASE_URL?: string;
  SHIPLOGIC_SANDBOX?: string;
  SHIPLOGIC_COLLECTION_JSON?: string;
  TCG_LOCKER_API_KEY?: string;
  CRAFTIES_PUDO_SHIPPING_AMOUNT?: string;
};

export async function storeEncryptedJobSecrets(
  jobId: number,
  payload: ExternalSecretPayload,
): Promise<void> {
  const plaintext = JSON.stringify(payload);
  const ciphertext = encryptSecret(plaintext);
  await execute(
    `INSERT INTO provisioning_job_secrets (job_id, ciphertext)
     VALUES (:jobId, :ciphertext)
     ON DUPLICATE KEY UPDATE
       ciphertext = VALUES(ciphertext),
       created_at = UTC_TIMESTAMP(3),
       consumed_at = NULL`,
    { jobId, ciphertext },
  );
}

/**
 * Decrypt hand-off ciphertext for use by the worker.
 * Does NOT delete the row — purge only after a successful provision so
 * failed jobs can retry idempotently with the same external secrets.
 * Plaintext never leaves this process (only tracked in SecretRedactor).
 */
export async function consumeEncryptedJobSecrets(
  jobId: number,
  redactor: SecretRedactor,
): Promise<ExternalSecretPayload | null> {
  const rows = await query<(RowDataPacket & { ciphertext: string })[]>(
    `SELECT ciphertext FROM provisioning_job_secrets
     WHERE job_id = :jobId
     LIMIT 1`,
    { jobId },
  );
  const row = rows[0];
  if (!row?.ciphertext) return null;

  let parsed: ExternalSecretPayload;
  try {
    const plaintext = decryptSecret(row.ciphertext);
    parsed = JSON.parse(plaintext) as ExternalSecretPayload;
  } catch (err) {
    throw new Error(
      `Failed to decrypt job secrets for #${jobId}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }

  redactor.trackMany(parsed);

  // Touch consumed_at as a breadcrumb; row remains until purgeOnSuccess.
  await execute(
    `UPDATE provisioning_job_secrets
     SET consumed_at = UTC_TIMESTAMP(3)
     WHERE job_id = :jobId`,
    { jobId },
  );

  return parsed;
}

/** Permanently delete ciphertext after provision succeeds (or operator cancels). */
export async function purgeEncryptedJobSecrets(jobId: number): Promise<void> {
  await execute(`DELETE FROM provisioning_job_secrets WHERE job_id = :jobId`, {
    jobId,
  });
}

export async function hasPendingJobSecrets(jobId: number): Promise<boolean> {
  const rows = await query<RowDataPacket[]>(
    `SELECT 1 AS ok FROM provisioning_job_secrets
     WHERE job_id = :jobId
     LIMIT 1`,
    { jobId },
  );
  return rows.length > 0;
}
