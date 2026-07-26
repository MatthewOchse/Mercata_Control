-- Commission billing: the sales figure a commission line was based on is
-- persisted so an issued invoice can always be re-explained, and the draft
-- review gate (approve before issue) gets explicit columns.
--
-- Recorded via schema_migrations — do not edit after apply.

-- Resolved monthly gross sales per tenant. One row per (tenant, calendar month).
-- ok = 0 means the figure could NOT be read: never treat that as zero sales.
CREATE TABLE IF NOT EXISTS tenant_sales_monthly (
  tenant_id     BIGINT UNSIGNED NOT NULL,
  period_year   SMALLINT UNSIGNED NOT NULL,
  period_month  TINYINT UNSIGNED  NOT NULL COMMENT '1-12, Africa/Johannesburg calendar month',
  period_start  DATE            NOT NULL,
  period_end    DATE            NOT NULL COMMENT 'Inclusive last day of the SAST month',
  gross_cents   BIGINT          NULL COMMENT 'Gross sales before refunds. NULL when ok = 0',
  order_count   INT UNSIGNED    NULL,
  currency      CHAR(3)         NOT NULL DEFAULT 'ZAR',
  source        VARCHAR(32)     NOT NULL COMMENT 'fleet | warehouse | manual',
  ok            TINYINT(1)      NOT NULL DEFAULT 0,
  error         TEXT            NULL,
  fetched_at    DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
                                  ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (tenant_id, period_year, period_month),
  KEY ix_tenant_sales_period (period_year, period_month),
  CONSTRAINT fk_tenant_sales_tenant
    FOREIGN KEY (tenant_id) REFERENCES tenants (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Draft review gate + commission provenance on the invoice itself.
-- status stays ENUM('draft','issued','paid','overdue','void'); "approved" is a
-- draft with approved_at set, so existing immutability invariants are untouched.
ALTER TABLE invoices
  ADD COLUMN approved_at DATETIME(3) NULL
    COMMENT 'Draft reviewed and cleared for issuing'
    AFTER status,
  ADD COLUMN approved_by VARCHAR(255) NULL AFTER approved_at,
  ADD COLUMN needs_attention TINYINT(1) NOT NULL DEFAULT 0
    COMMENT 'Draft is incomplete (e.g. sales figure unreadable) and blocks approval'
    AFTER approved_by,
  ADD COLUMN attention_reason VARCHAR(255) NULL AFTER needs_attention,
  ADD COLUMN commission_rate DECIMAL(6,4) NULL
    COMMENT 'Rate applied at draft time. Snapshot, never re-read from plans'
    AFTER total_cents,
  ADD COLUMN commission_basis_cents BIGINT NULL
    COMMENT 'Gross sales the commission was calculated on'
    AFTER commission_rate,
  ADD COLUMN commission_cents BIGINT NULL AFTER commission_basis_cents,
  ADD COLUMN sales_period_start DATE NULL
    COMMENT 'Sales month measured (differs from billing period: bill in advance)'
    AFTER commission_cents,
  ADD COLUMN sales_period_end DATE NULL AFTER sales_period_start,
  ADD COLUMN sales_source VARCHAR(32) NULL AFTER sales_period_end,
  ADD KEY ix_invoices_needs_attention (needs_attention, status);
