-- Starter → flat-tier graduation monitor. NOTIFY ONLY.
-- Nothing in this schema changes a tenant's plan: the operator decides, and
-- the change is recorded in audit_log with actor + from/to plan.
--
-- Recorded via schema_migrations — do not edit after apply.

CREATE TABLE IF NOT EXISTS graduation_flags (
  id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id           BIGINT UNSIGNED NOT NULL,
  from_plan_code      VARCHAR(32)     NOT NULL,
  suggested_plan_code VARCHAR(32)     NOT NULL,
  threshold_cents     BIGINT UNSIGNED NOT NULL,
  -- The two consecutive months that breached the threshold. month2 is the later.
  month1_start        DATE            NOT NULL,
  month1_gross_cents  BIGINT          NOT NULL,
  month2_start        DATE            NOT NULL,
  month2_gross_cents  BIGINT          NOT NULL,
  -- Cost comparison at detection time (snapshot, for the operator's message).
  starter_cost_cents  BIGINT          NOT NULL COMMENT 'Base + commission on month2 gross',
  flat_cost_cents     BIGINT          NOT NULL COMMENT 'Suggested flat plan monthly',
  saving_cents        BIGINT          NOT NULL COMMENT 'starter_cost minus flat_cost. Negative means Starter is still cheaper',
  status              ENUM('open','dismissed','graduated') NOT NULL DEFAULT 'open',
  detected_at         DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  resolved_at         DATETIME(3)     NULL,
  resolved_by         VARCHAR(255)    NULL,
  PRIMARY KEY (id),
  UNIQUE KEY ux_graduation_tenant_month (tenant_id, month2_start),
  KEY ix_graduation_status (status, detected_at),
  CONSTRAINT fk_graduation_tenant
    FOREIGN KEY (tenant_id) REFERENCES tenants (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
