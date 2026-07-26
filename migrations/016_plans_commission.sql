-- Plans become the single source of truth for pricing *policy*
-- (commission rate, graduation threshold, eligibility, product line).
--
-- Base monthly price stays snapshotted on subscriptions.current_monthly_cents:
-- that is deliberate, so a negotiated discount survives a catalog edit and
-- historical invoices are never re-priced. plans.monthly_cents remains the
-- default offered when a tenant is put on a plan.
--
-- Recorded via schema_migrations — do not edit after apply.

ALTER TABLE plans
  ADD COLUMN product_line ENUM('retail','sites') NOT NULL DEFAULT 'retail'
    COMMENT 'RETAIL = shop/commerce plans, SITES = website hosting'
    AFTER name,
  ADD COLUMN commission_rate DECIMAL(6,4) NOT NULL DEFAULT 0.0000
    COMMENT '0.0200 means 2 percent of gross sales. 0 for flat tiers'
    AFTER monthly_cents,
  ADD COLUMN commission_basis ENUM('gross') NOT NULL DEFAULT 'gross'
    COMMENT 'Only GROSS supported: sales before refunds/cancellations'
    AFTER commission_rate,
  ADD COLUMN graduation_threshold_cents BIGINT UNSIGNED NULL
    COMMENT 'Monthly gross above which the operator is prompted to move the tenant to a flat tier'
    AFTER commission_basis,
  ADD COLUMN graduate_to_code VARCHAR(32) NULL
    COMMENT 'Plan suggested when the threshold is breached'
    AFTER graduation_threshold_cents,
  ADD COLUMN eligibility VARCHAR(64) NULL
    COMMENT 'Free-text sales constraint, e.g. online-only'
    AFTER graduate_to_code,
  ADD COLUMN sort_order SMALLINT UNSIGNED NOT NULL DEFAULT 100
    AFTER eligibility;

-- Existing plans are flat: commission_rate stays 0.
UPDATE plans SET product_line = 'sites' WHERE code = 'service_hosting';
UPDATE plans SET product_line = 'retail'
  WHERE code IN ('online', 'retail', 'retail_pro');

UPDATE plans SET sort_order = 20 WHERE code = 'online';
UPDATE plans SET sort_order = 30 WHERE code = 'retail';
UPDATE plans SET sort_order = 40 WHERE code = 'retail_pro';
UPDATE plans SET sort_order = 50 WHERE code = 'service_hosting';

-- Starter: R300/month + 2% of gross sales, graduating at R60 000/month.
INSERT INTO plans
  (code, name, product_line, monthly_cents, commission_rate, commission_basis,
   graduation_threshold_cents, graduate_to_code, eligibility, sort_order, active)
VALUES
  ('starter', 'Starter', 'retail', 30000, 0.0200, 'gross',
   6000000, 'online', 'online-only', 10, 1)
ON DUPLICATE KEY UPDATE
  name = VALUES(name),
  product_line = VALUES(product_line),
  commission_rate = VALUES(commission_rate),
  commission_basis = VALUES(commission_basis),
  graduation_threshold_cents = VALUES(graduation_threshold_cents),
  graduate_to_code = VALUES(graduate_to_code),
  eligibility = VALUES(eligibility),
  sort_order = VALUES(sort_order);

-- "Sites" is the customer-facing name for the website hosting line.
UPDATE plans SET name = 'Sites' WHERE code = 'service_hosting';
