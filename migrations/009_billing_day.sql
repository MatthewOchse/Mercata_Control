-- Per-tenant billing day of month (when they are billed / invoice due day).
-- Recorded via schema_migrations — do not edit after apply.

ALTER TABLE tenants
  ADD COLUMN billing_day TINYINT UNSIGNED NOT NULL DEFAULT 1
    COMMENT 'Day of month (1-28) they are billed / invoice due'
    AFTER payment_due_days;
