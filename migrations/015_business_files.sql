-- Business file vault (Mercata-wide + per-tenant).
-- Recorded via schema_migrations — do not edit after apply.

CREATE TABLE IF NOT EXISTS business_files (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id       BIGINT UNSIGNED NULL,
  category        VARCHAR(64)     NOT NULL DEFAULT 'general',
  original_name   VARCHAR(255)    NOT NULL,
  storage_path    VARCHAR(512)    NOT NULL,
  mime_type       VARCHAR(127)    NOT NULL,
  size_bytes      BIGINT UNSIGNED NOT NULL,
  uploaded_by     VARCHAR(255)    NOT NULL,
  notes           TEXT            NULL,
  created_at      DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  deleted_at      DATETIME(3)     NULL,
  PRIMARY KEY (id),
  KEY ix_business_files_tenant (tenant_id, created_at),
  KEY ix_business_files_category (category, created_at),
  CONSTRAINT fk_business_files_tenant
    FOREIGN KEY (tenant_id) REFERENCES tenants (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
