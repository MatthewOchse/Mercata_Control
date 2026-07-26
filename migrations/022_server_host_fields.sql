-- Extend servers with host-specific provision metadata (public IP, DB, deploy path)
-- and a surrogate id. Capacity awareness (019) stays; tenant_infra.host still
-- links by name (no FK). Provisioning does not read these columns yet.
--
-- Recorded via schema_migrations — do not edit after apply.

-- Surrogate PK; keep name as the stable join key for tenant_infra.host.
ALTER TABLE servers
  DROP PRIMARY KEY,
  ADD COLUMN id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT FIRST,
  ADD PRIMARY KEY (id),
  ADD UNIQUE KEY ux_servers_name (name);

ALTER TABLE servers
  ADD COLUMN public_ip   VARCHAR(45)      NULL
    COMMENT 'Public IPv4/IPv6 for DNS A/AAAA pointing at this box',
  ADD COLUMN db_host     VARCHAR(255)     NULL
    COMMENT 'MySQL host as reached by the provision worker on this box',
  ADD COLUMN db_port     SMALLINT UNSIGNED NULL
    COMMENT 'MySQL port for tenant DB create/seed on this box',
  ADD COLUMN deploy_path VARCHAR(512)     NULL
    COMMENT 'Fleet repo root on this box (FLEET_REPO_ROOT)';

-- Register / refresh Caesar as the first provision target (source of truth).
-- Does not touch tenant_infra or any tenant row.
INSERT INTO servers (
  name, label, public_ip, db_host, db_port, deploy_path, capacity, active, notes
) VALUES (
  'caesar',
  'Primary application host',
  '165.49.25.59',
  '127.0.0.1',
  3306,
  '/home/matthew/caesar/sites/web',
  14,
  1,
  'Caesar — primary box. Live compose/Caddy/tenants via FLEET_DEPLOY_DIR=/home/matthew/caesar/fleet.'
)
ON DUPLICATE KEY UPDATE
  label       = VALUES(label),
  public_ip   = VALUES(public_ip),
  db_host     = VALUES(db_host),
  db_port     = VALUES(db_port),
  deploy_path = VALUES(deploy_path),
  capacity    = VALUES(capacity),
  active      = VALUES(active),
  notes       = VALUES(notes);
