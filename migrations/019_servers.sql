-- Server capacity awareness. Not auto-provisioning: this only tells the
-- operator when a box is filling up so the next one is ordered early.
--
-- tenant_infra.host already carries the box name as free text; that stays the
-- link (no FK, so an unknown host never blocks tenant creation).
--
-- Recorded via schema_migrations — do not edit after apply.

CREATE TABLE IF NOT EXISTS servers (
  name        VARCHAR(64)       NOT NULL COMMENT 'Matches tenant_infra.host',
  label       VARCHAR(120)      NULL,
  capacity    SMALLINT UNSIGNED NOT NULL DEFAULT 14
                COMMENT 'Tenant ceiling before the box is considered full',
  notes       TEXT              NULL,
  active      TINYINT(1)        NOT NULL DEFAULT 1,
  created_at  DATETIME(3)       NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at  DATETIME(3)       NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
                                  ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Register the boxes already referenced by live tenants.
INSERT INTO servers (name, capacity, active)
SELECT DISTINCT ti.host, 14, 1
FROM tenant_infra ti
WHERE TRIM(COALESCE(ti.host, '')) <> ''
ON DUPLICATE KEY UPDATE updated_at = CURRENT_TIMESTAMP(3);

-- Guarantee the primary box exists even with no tenants yet.
INSERT INTO servers (name, label, capacity, active)
VALUES ('caesar', 'Primary application host', 14, 1)
ON DUPLICATE KEY UPDATE updated_at = CURRENT_TIMESTAMP(3);
