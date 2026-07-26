-- Plan catalog: retire Retail Pro, add Service Hosting (R400/mo).
-- Recorded via schema_migrations — do not edit after apply.

UPDATE plans SET active = 0, name = 'Retail Pro (retired)'
WHERE code = 'retail_pro';

INSERT INTO plans (code, name, monthly_cents, active) VALUES
  ('service_hosting', 'Service Hosting', 40000, 1)
ON DUPLICATE KEY UPDATE
  name = VALUES(name),
  monthly_cents = VALUES(monthly_cents),
  active = 1;
