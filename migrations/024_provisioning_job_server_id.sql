-- Target server for each provisioning job (FK → servers.id).
-- Required: workers only claim jobs where target_server_id = their MERCATA_SERVER_ID.
-- Back-fill existing jobs to Caesar. Depends on 022_server_host_fields.
--
-- Recorded via schema_migrations — do not edit after apply.

ALTER TABLE provisioning_jobs
  ADD COLUMN target_server_id BIGINT UNSIGNED NULL
    COMMENT 'FK to servers.id — which box worker may claim this job'
    AFTER db_name;

-- Prefer JSON host name when present; otherwise Caesar (back-compat).
UPDATE provisioning_jobs pj
INNER JOIN servers s
  ON s.name = LOWER(COALESCE(
    NULLIF(JSON_UNQUOTE(JSON_EXTRACT(pj.non_sensitive_config, '$.host')), 'null'),
    'caesar'
  ))
SET pj.target_server_id = s.id
WHERE pj.target_server_id IS NULL;

UPDATE provisioning_jobs
SET target_server_id = (SELECT id FROM servers WHERE name = 'caesar' LIMIT 1)
WHERE target_server_id IS NULL;

ALTER TABLE provisioning_jobs
  MODIFY COLUMN target_server_id BIGINT UNSIGNED NOT NULL,
  ADD KEY ix_provisioning_jobs_target_server_status (target_server_id, status),
  ADD CONSTRAINT fk_provisioning_jobs_target_server
    FOREIGN KEY (target_server_id) REFERENCES servers (id);
