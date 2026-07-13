-- Fleet health monitoring.
-- Recorded via schema_migrations — do not edit after apply.

CREATE TABLE IF NOT EXISTS health_checks (
  id                    BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id             BIGINT UNSIGNED NOT NULL,
  checked_at            DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  ok                    TINYINT(1)      NOT NULL,
  latency_ms            INT UNSIGNED    NULL,
  cert_days_remaining   INT             NULL,
  https_ok              TINYINT(1)      NULL,
  fleet_ok              TINYINT(1)      NULL,
  payload               JSON            NULL,
  error                 TEXT            NULL,
  PRIMARY KEY (id),
  KEY ix_health_checks_tenant_checked (tenant_id, checked_at),
  KEY ix_health_checks_checked (checked_at),
  CONSTRAINT fk_health_checks_tenant
    FOREIGN KEY (tenant_id) REFERENCES tenants (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS maintenance_windows (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id       BIGINT UNSIGNED NOT NULL,
  starts_at       DATETIME(3)     NOT NULL,
  ends_at         DATETIME(3)     NOT NULL,
  reason          VARCHAR(255)    NOT NULL,
  created_by      VARCHAR(255)    NOT NULL,
  created_at      DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY ix_maintenance_tenant_window (tenant_id, starts_at, ends_at),
  CONSTRAINT fk_maintenance_tenant
    FOREIGN KEY (tenant_id) REFERENCES tenants (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Per-tenant per-signal alert state. Fires on state change only.
CREATE TABLE IF NOT EXISTS alert_states (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id       BIGINT UNSIGNED NOT NULL,
  `signal`        VARCHAR(64)     NOT NULL,
  severity        ENUM('critical','warning') NOT NULL,
  status          ENUM('open','resolved') NOT NULL DEFAULT 'resolved',
  details         JSON            NULL,
  opened_at       DATETIME(3)     NULL,
  resolved_at     DATETIME(3)     NULL,
  last_fired_at   DATETIME(3)     NULL,
  cooldown_until  DATETIME(3)     NULL,
  updated_at      DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY ux_alert_states_tenant_signal (tenant_id, `signal`),
  KEY ix_alert_states_status (status),
  CONSTRAINT fk_alert_states_tenant
    FOREIGN KEY (tenant_id) REFERENCES tenants (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Warning alerts waiting for the 08:00 SAST digest.
CREATE TABLE IF NOT EXISTS alert_digest_queue (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id       BIGINT UNSIGNED NOT NULL,
  `signal`        VARCHAR(64)     NOT NULL,
  event           ENUM('opened','recovered') NOT NULL,
  severity        ENUM('critical','warning') NOT NULL DEFAULT 'warning',
  message         TEXT            NOT NULL,
  details         JSON            NULL,
  created_at      DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  sent_at         DATETIME(3)     NULL,
  PRIMARY KEY (id),
  KEY ix_digest_unsent (sent_at, created_at),
  CONSTRAINT fk_digest_tenant
    FOREIGN KEY (tenant_id) REFERENCES tenants (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS alert_events (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id       BIGINT UNSIGNED NOT NULL,
  `signal`        VARCHAR(64)     NOT NULL,
  event           ENUM('opened','recovered') NOT NULL,
  severity        ENUM('critical','warning') NOT NULL,
  channel         VARCHAR(32)     NOT NULL,
  message         TEXT            NOT NULL,
  created_at      DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY ix_alert_events_tenant (tenant_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
