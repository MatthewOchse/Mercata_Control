-- Invoice delivery, dunning, and operator tasks.
-- Recorded via schema_migrations — do not edit after apply.

CREATE TABLE IF NOT EXISTS dunning_reminders (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  invoice_id      BIGINT UNSIGNED NOT NULL,
  stage           ENUM('overdue','plus_7','plus_14','plus_21') NOT NULL,
  sent_at         DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  channel         VARCHAR(32)     NOT NULL DEFAULT 'email',
  recipient       VARCHAR(255)    NULL,
  PRIMARY KEY (id),
  UNIQUE KEY ux_dunning_invoice_stage (invoice_id, stage),
  KEY ix_dunning_sent (sent_at),
  CONSTRAINT fk_dunning_invoice
    FOREIGN KEY (invoice_id) REFERENCES invoices (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS operator_tasks (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  kind            VARCHAR(64)     NOT NULL,
  tenant_id       BIGINT UNSIGNED NULL,
  invoice_id      BIGINT UNSIGNED NULL,
  title           VARCHAR(255)    NOT NULL,
  body            TEXT            NULL,
  status          ENUM('open','done','dismissed') NOT NULL DEFAULT 'open',
  created_at      DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  resolved_at     DATETIME(3)     NULL,
  resolved_by     VARCHAR(255)    NULL,
  PRIMARY KEY (id),
  KEY ix_operator_tasks_status (status, created_at),
  KEY ix_operator_tasks_tenant (tenant_id),
  CONSTRAINT fk_operator_tasks_tenant
    FOREIGN KEY (tenant_id) REFERENCES tenants (id),
  CONSTRAINT fk_operator_tasks_invoice
    FOREIGN KEY (invoice_id) REFERENCES invoices (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
