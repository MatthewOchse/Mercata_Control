-- Bind every tenant in the CRM registry to a Server.
-- All existing tenants live on Caesar; back-fill then require server_id.
-- Does not change tenant_infra.host, containers, domains, or fleet secrets.
--
-- Recorded via schema_migrations — do not edit after apply.
-- Depends on 022_server_host_fields (servers.id + caesar row).

ALTER TABLE tenants
  ADD COLUMN server_id BIGINT UNSIGNED NULL
    COMMENT 'FK to servers.id — box this tenant is assigned to'
    AFTER id;

-- Back-fill: every existing tenant → Caesar.
UPDATE tenants
SET server_id = (SELECT id FROM servers WHERE name = 'caesar' LIMIT 1)
WHERE server_id IS NULL;

-- Require going forward. Fails if Caesar was missing (any NULL remains).
ALTER TABLE tenants
  MODIFY COLUMN server_id BIGINT UNSIGNED NOT NULL,
  ADD KEY ix_tenants_server (server_id),
  ADD CONSTRAINT fk_tenants_server
    FOREIGN KEY (server_id) REFERENCES servers (id);

-- ---------------------------------------------------------------------------
-- Verification (run after migrate; expect 0 nulls, crafties+geist → caesar):
--
--   SELECT t.slug, t.server_id, s.name AS server_name, s.public_ip
--   FROM tenants t
--   INNER JOIN servers s ON s.id = t.server_id
--   ORDER BY t.slug;
--
--   SELECT COUNT(*) AS tenants_missing_server
--   FROM tenants WHERE server_id IS NULL;
--   -- → 0
--
--   SELECT t.slug, s.name
--   FROM tenants t
--   INNER JOIN servers s ON s.id = t.server_id
--   WHERE t.slug IN ('crafties', 'geist');
--   -- → both rows, name = caesar
-- ---------------------------------------------------------------------------
