-- One-time encrypted secret hand-off for provisioning jobs.
-- Plaintext never stored. Worker decrypts with ENCRYPTION_KEY, writes .env, then DELETE.
-- Recorded via schema_migrations — do not edit after apply.

CREATE TABLE IF NOT EXISTS provisioning_job_secrets (
  job_id       BIGINT UNSIGNED NOT NULL,
  ciphertext   TEXT            NOT NULL
                 COMMENT 'AES-256-GCM v1 payload (encryptSecret) of JSON external secrets',
  created_at   DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  consumed_at  DATETIME(3)     NULL
                 COMMENT 'Set when worker decrypts, immediately before DELETE',
  PRIMARY KEY (job_id),
  CONSTRAINT fk_provisioning_job_secrets_job
    FOREIGN KEY (job_id) REFERENCES provisioning_jobs (id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Super-admin gate for provision UI (single-operator installs: existing row is super).
ALTER TABLE operators
  ADD COLUMN is_super TINYINT(1) NOT NULL DEFAULT 1
    AFTER totp_confirmed;
