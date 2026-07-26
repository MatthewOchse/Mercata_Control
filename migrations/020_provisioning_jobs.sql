-- Provisioning jobs: admin requests a new tenant, a host-side worker on Caesar
-- runs `tenant:provision` (and related steps). No secrets in this table.
-- Recorded via schema_migrations — do not edit after apply.

CREATE TABLE IF NOT EXISTS provisioning_jobs (
  id                    BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id             VARCHAR(64)     NOT NULL
                          COMMENT 'Fleet tenant slug to provision (e.g. acme)',
  tier                  ENUM('online','retail') NOT NULL,
  domain                VARCHAR(255)    NOT NULL,
  db_name               VARCHAR(64)     NOT NULL,
  status                ENUM(
                          'queued',
                          'running',
                          'awaiting_env',
                          'succeeded',
                          'failed'
                        ) NOT NULL DEFAULT 'queued',
  created_by            BIGINT UNSIGNED NOT NULL,
  created_at            DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  started_at            DATETIME(3)     NULL,
  finished_at           DATETIME(3)     NULL,
  log_text              MEDIUMTEXT      NULL,
  non_sensitive_config  JSON            NULL
                          COMMENT 'Extra non-secret options (displayName, host, flags)',
  PRIMARY KEY (id),
  KEY ix_provisioning_jobs_status_created (status, created_at),
  KEY ix_provisioning_jobs_tenant (tenant_id),
  CONSTRAINT fk_provisioning_jobs_created_by
    FOREIGN KEY (created_by) REFERENCES operators (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
