-- Mercata Control Plane initial schema.
-- Recorded via schema_migrations — do not edit after apply.
-- Money is integer cents (ZAR). Timestamps are UTC.

CREATE TABLE IF NOT EXISTS operators (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  email           VARCHAR(255)    NOT NULL,
  password_hash   VARCHAR(255)    NOT NULL,
  totp_secret     VARCHAR(64)     NOT NULL,
  totp_confirmed  TINYINT(1)      NOT NULL DEFAULT 0,
  display_name    VARCHAR(120)    NOT NULL DEFAULT 'Operator',
  created_at      DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at      DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY ux_operators_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS sessions (
  id              CHAR(36)        NOT NULL,
  operator_id     BIGINT UNSIGNED NOT NULL,
  token_hash      CHAR(64)        NOT NULL,
  expires_at      DATETIME(3)     NOT NULL,
  created_at      DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  last_seen_at    DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  user_agent      VARCHAR(512)    NULL,
  ip              VARCHAR(45)     NULL,
  PRIMARY KEY (id),
  UNIQUE KEY ux_sessions_token_hash (token_hash),
  KEY ix_sessions_operator (operator_id),
  KEY ix_sessions_expires (expires_at),
  CONSTRAINT fk_sessions_operator
    FOREIGN KEY (operator_id) REFERENCES operators (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS tenants (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  slug            VARCHAR(64)     NOT NULL,
  legal_name      VARCHAR(255)    NOT NULL,
  trading_name    VARCHAR(255)    NOT NULL,
  status          ENUM('prospect','active','suspended','offboarded') NOT NULL DEFAULT 'prospect',
  onboarded_at    DATETIME(3)     NULL,
  offboarded_at   DATETIME(3)     NULL,
  notes           TEXT            NULL,
  created_at      DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at      DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY ux_tenants_slug (slug),
  KEY ix_tenants_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS tenant_contacts (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id       BIGINT UNSIGNED NOT NULL,
  name            VARCHAR(255)    NOT NULL,
  email           VARCHAR(255)    NOT NULL,
  phone           VARCHAR(64)     NULL,
  role            ENUM('billing','technical','primary') NOT NULL DEFAULT 'primary',
  is_primary      TINYINT(1)      NOT NULL DEFAULT 0,
  created_at      DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at      DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY ix_tenant_contacts_tenant (tenant_id),
  KEY ix_tenant_contacts_email (email),
  CONSTRAINT fk_tenant_contacts_tenant
    FOREIGN KEY (tenant_id) REFERENCES tenants (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS tenant_infra (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id       BIGINT UNSIGNED NOT NULL,
  primary_domain  VARCHAR(255)    NOT NULL,
  extra_domains   JSON            NULL,
  container_name  VARCHAR(128)    NOT NULL,
  db_name         VARCHAR(128)    NOT NULL,
  host            VARCHAR(255)    NOT NULL,
  fleet_secret    TEXT            NOT NULL,
  health_path     VARCHAR(255)    NOT NULL DEFAULT '/api/_fleet/health',
  created_at      DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at      DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY ux_tenant_infra_tenant (tenant_id),
  UNIQUE KEY ux_tenant_infra_container (container_name),
  UNIQUE KEY ux_tenant_infra_db (db_name),
  CONSTRAINT fk_tenant_infra_tenant
    FOREIGN KEY (tenant_id) REFERENCES tenants (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS plans (
  code            VARCHAR(32)     NOT NULL,
  name            VARCHAR(120)    NOT NULL,
  monthly_cents   INT UNSIGNED    NOT NULL,
  active          TINYINT(1)      NOT NULL DEFAULT 1,
  created_at      DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at      DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO plans (code, name, monthly_cents, active) VALUES
  ('online', 'Online', 150000, 1),
  ('retail', 'Retail', 220000, 1),
  ('retail_pro', 'Retail Pro', 280000, 0),
  ('service_hosting', 'Service Hosting', 40000, 1)
ON DUPLICATE KEY UPDATE name = VALUES(name);

CREATE TABLE IF NOT EXISTS subscriptions (
  id                    BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id             BIGINT UNSIGNED NOT NULL,
  plan_code             VARCHAR(32)     NOT NULL,
  status                ENUM('active','cancelled') NOT NULL DEFAULT 'active',
  started_on            DATE            NOT NULL,
  ends_on               DATE            NULL,
  current_monthly_cents INT UNSIGNED    NOT NULL,
  created_at            DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at            DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY ix_subscriptions_tenant (tenant_id),
  KEY ix_subscriptions_status (status),
  CONSTRAINT fk_subscriptions_tenant
    FOREIGN KEY (tenant_id) REFERENCES tenants (id),
  CONSTRAINT fk_subscriptions_plan
    FOREIGN KEY (plan_code) REFERENCES plans (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS addons (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id       BIGINT UNSIGNED NOT NULL,
  description     VARCHAR(255)    NOT NULL,
  kind            ENUM('recurring','once_off') NOT NULL,
  amount_cents    INT             NOT NULL,
  active_from     DATE            NOT NULL,
  active_until    DATE            NULL,
  created_at      DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at      DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY ix_addons_tenant (tenant_id),
  KEY ix_addons_active (tenant_id, active_from, active_until),
  CONSTRAINT fk_addons_tenant
    FOREIGN KEY (tenant_id) REFERENCES tenants (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS invoices (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id       BIGINT UNSIGNED NOT NULL,
  invoice_number  VARCHAR(32)     NULL,
  status          ENUM('draft','issued','paid','overdue','void') NOT NULL DEFAULT 'draft',
  issue_date      DATE            NULL,
  due_date        DATE            NULL,
  period_start    DATE            NOT NULL,
  period_end      DATE            NOT NULL,
  subtotal_cents  INT             NOT NULL DEFAULT 0,
  vat_cents       INT             NOT NULL DEFAULT 0,
  total_cents     INT             NOT NULL DEFAULT 0,
  pdf_path        VARCHAR(512)    NULL,
  issued_at       DATETIME(3)     NULL,
  sent_at         DATETIME(3)     NULL,
  created_at      DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at      DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY ux_invoices_number (invoice_number),
  KEY ix_invoices_tenant (tenant_id),
  KEY ix_invoices_status (status),
  KEY ix_invoices_period (period_start, period_end),
  CONSTRAINT fk_invoices_tenant
    FOREIGN KEY (tenant_id) REFERENCES tenants (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS invoice_lines (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  invoice_id      BIGINT UNSIGNED NOT NULL,
  description     VARCHAR(512)    NOT NULL,
  quantity        INT UNSIGNED    NOT NULL DEFAULT 1,
  unit_cents      INT             NOT NULL,
  line_total_cents INT            NOT NULL,
  sort_order      INT             NOT NULL DEFAULT 0,
  created_at      DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY ix_invoice_lines_invoice (invoice_id),
  CONSTRAINT fk_invoice_lines_invoice
    FOREIGN KEY (invoice_id) REFERENCES invoices (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS credit_notes (
  id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  credit_note_number  VARCHAR(32)     NOT NULL,
  invoice_id          BIGINT UNSIGNED NOT NULL,
  reason              TEXT            NOT NULL,
  total_cents         INT             NOT NULL,
  issued_at           DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  created_at          DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY ux_credit_notes_number (credit_note_number),
  KEY ix_credit_notes_invoice (invoice_id),
  CONSTRAINT fk_credit_notes_invoice
    FOREIGN KEY (invoice_id) REFERENCES invoices (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS payments (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id       BIGINT UNSIGNED NOT NULL,
  invoice_id      BIGINT UNSIGNED NULL,
  amount_cents    INT             NOT NULL,
  method          ENUM('eft','payfast','debit_order','other') NOT NULL,
  reference       VARCHAR(255)    NULL,
  received_on     DATE            NOT NULL,
  captured_by     VARCHAR(120)    NOT NULL,
  created_at      DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at      DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY ix_payments_tenant (tenant_id),
  KEY ix_payments_invoice (invoice_id),
  KEY ix_payments_received (received_on),
  CONSTRAINT fk_payments_tenant
    FOREIGN KEY (tenant_id) REFERENCES tenants (id),
  CONSTRAINT fk_payments_invoice
    FOREIGN KEY (invoice_id) REFERENCES invoices (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS number_sequences (
  `key`           ENUM('invoice','credit_note') NOT NULL,
  year            SMALLINT UNSIGNED NOT NULL,
  `last_value`    INT UNSIGNED    NOT NULL DEFAULT 0,
  updated_at      DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`key`, year)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS audit_log (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  actor           VARCHAR(255)    NOT NULL,
  action          VARCHAR(64)     NOT NULL,
  entity_type     VARCHAR(64)     NOT NULL,
  entity_id       VARCHAR(64)     NOT NULL,
  before_json     JSON            NULL,
  after_json      JSON            NULL,
  created_at      DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY ix_audit_log_entity (entity_type, entity_id),
  KEY ix_audit_log_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
