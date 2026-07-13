-- Customer analytics digests + WhatsApp consent scaffold.
-- Recorded via schema_migrations — do not edit after apply.

ALTER TABLE tenants
  ADD COLUMN digest_cadence ENUM('daily','weekly','off') NOT NULL DEFAULT 'weekly'
    AFTER notes,
  ADD COLUMN digest_day TINYINT UNSIGNED NOT NULL DEFAULT 1
    COMMENT '1=Mon through 7=Sun ISO weekday when cadence=weekly'
    AFTER digest_cadence,
  ADD COLUMN ga4_property_id VARCHAR(64) NULL AFTER digest_day,
  ADD COLUMN brand_primary_color CHAR(7) NULL AFTER ga4_property_id,
  ADD COLUMN brand_logo_url VARCHAR(512) NULL AFTER brand_primary_color;

ALTER TABLE tenant_contacts
  ADD COLUMN whatsapp_number VARCHAR(32) NULL AFTER phone,
  ADD COLUMN whatsapp_opt_in TINYINT(1) NOT NULL DEFAULT 0 AFTER whatsapp_number;

CREATE TABLE IF NOT EXISTS digest_sends (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id       BIGINT UNSIGNED NOT NULL,
  cadence         ENUM('daily','weekly') NOT NULL,
  period_start    DATE            NOT NULL,
  period_end      DATE            NOT NULL,
  recipient       VARCHAR(255)    NOT NULL,
  subject         VARCHAR(255)    NOT NULL,
  status          ENUM('sent','failed') NOT NULL,
  error           TEXT            NULL,
  sent_at         DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY ix_digest_sends_tenant (tenant_id, sent_at),
  KEY ix_digest_sends_period (tenant_id, period_start, period_end),
  CONSTRAINT fk_digest_sends_tenant
    FOREIGN KEY (tenant_id) REFERENCES tenants (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
