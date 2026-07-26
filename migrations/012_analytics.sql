-- Analytics warehouse + GA4 verification + monthly digests.
-- Prompt 14 named this 003_analytics.sql; next free id here is 012.

ALTER TABLE tenants
  ADD COLUMN ga4_verified_at DATETIME(3) NULL
    AFTER ga4_property_id,
  ADD COLUMN ga4_display_name VARCHAR(255) NULL
    AFTER ga4_verified_at,
  ADD COLUMN ga4_consecutive_failures INT UNSIGNED NOT NULL DEFAULT 0
    AFTER ga4_display_name;

-- Expand digest cadence to include monthly (was daily|weekly|off).
ALTER TABLE tenants
  MODIFY COLUMN digest_cadence ENUM('daily','weekly','monthly','off')
    NOT NULL DEFAULT 'weekly';

ALTER TABLE digest_sends
  MODIFY COLUMN cadence ENUM('daily','weekly','monthly') NOT NULL;

CREATE TABLE IF NOT EXISTS analytics_daily (
  tenant_id         BIGINT UNSIGNED NOT NULL,
  `date`            DATE            NOT NULL,
  source            ENUM('internal','ga4') NOT NULL,
  sessions          INT UNSIGNED    NULL,
  users             INT UNSIGNED    NULL,
  new_users         INT UNSIGNED    NULL,
  pageviews         INT UNSIGNED    NULL,
  engaged_sessions  INT UNSIGNED    NULL,
  orders            INT UNSIGNED    NULL,
  gross_cents       BIGINT          NULL,
  refunds_cents     BIGINT          NULL,
  net_cents         BIGINT          NULL,
  updated_at        DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
                                      ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (tenant_id, `date`, source),
  KEY idx_analytics_daily_date (`date`),
  CONSTRAINT fk_analytics_daily_tenant
    FOREIGN KEY (tenant_id) REFERENCES tenants (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS analytics_daily_detail (
  tenant_id   BIGINT UNSIGNED NOT NULL,
  `date`      DATE            NOT NULL,
  kind        ENUM('top_pages','top_sources','top_products') NOT NULL,
  payload     JSON            NOT NULL,
  updated_at  DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
                                ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (tenant_id, `date`, kind),
  CONSTRAINT fk_analytics_detail_tenant
    FOREIGN KEY (tenant_id) REFERENCES tenants (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS analytics_syncs (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id     BIGINT UNSIGNED NOT NULL,
  source        ENUM('internal','ga4') NOT NULL,
  period_start  DATE            NOT NULL,
  period_end    DATE            NOT NULL,
  ran_at        DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  ok            TINYINT(1)      NOT NULL,
  error         TEXT            NULL,
  rows_written  INT UNSIGNED    NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  KEY idx_analytics_syncs_tenant (tenant_id, ran_at),
  CONSTRAINT fk_analytics_syncs_tenant
    FOREIGN KEY (tenant_id) REFERENCES tenants (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
