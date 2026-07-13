-- Invoice billing support: track billed once-off addons; optional customer VAT number.
-- Recorded via schema_migrations — do not edit after apply.

ALTER TABLE addons
  ADD COLUMN billed_invoice_id BIGINT UNSIGNED NULL AFTER active_until,
  ADD KEY ix_addons_billed (billed_invoice_id),
  ADD CONSTRAINT fk_addons_billed_invoice
    FOREIGN KEY (billed_invoice_id) REFERENCES invoices (id);

ALTER TABLE tenants
  ADD COLUMN vat_number VARCHAR(32) NULL AFTER trading_name;
