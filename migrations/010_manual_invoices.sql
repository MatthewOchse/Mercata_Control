-- Manual (custom) invoices are excluded from auto draft rebuild.
ALTER TABLE invoices
  ADD COLUMN source ENUM('auto','manual') NOT NULL DEFAULT 'auto'
  AFTER status;
