-- Per-tenant billing terms: payment due days after invoice issue.
-- Recorded via schema_migrations — do not edit after apply.

ALTER TABLE tenants
  ADD COLUMN payment_due_days SMALLINT UNSIGNED NOT NULL DEFAULT 7
    COMMENT 'Days after invoice issue_date until due_date'
    AFTER notes;
