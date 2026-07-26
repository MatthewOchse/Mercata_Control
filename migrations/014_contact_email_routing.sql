-- Email routing flags: invoices vs analytics digests can go to different / multiple contacts.
-- Recorded via schema_migrations — do not edit after apply.

ALTER TABLE tenant_contacts
  ADD COLUMN receive_invoices TINYINT(1) NOT NULL DEFAULT 0
    AFTER is_primary,
  ADD COLUMN receive_digests TINYINT(1) NOT NULL DEFAULT 0
    AFTER receive_invoices;

-- Preserve current behaviour as the default backfill.
UPDATE tenant_contacts SET receive_invoices = 1 WHERE role = 'billing';
UPDATE tenant_contacts
   SET receive_digests = 1
 WHERE is_primary = 1 OR role IN ('primary', 'billing');
