-- Bank statement imports (FNB OFX) for payment reconciliation.
-- Prompt referenced 002_bank.sql; next free id in this repo is 011.

CREATE TABLE IF NOT EXISTS statement_imports (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  filename          VARCHAR(255)    NOT NULL,
  format            ENUM('ofx','csv') NOT NULL DEFAULT 'ofx',
  period_start      DATE            NOT NULL,
  period_end        DATE            NOT NULL,
  imported_at       DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  transaction_count INT UNSIGNED    NOT NULL DEFAULT 0,
  new_count         INT UNSIGNED    NOT NULL DEFAULT 0,
  duplicate_count   INT UNSIGNED    NOT NULL DEFAULT 0,
  imported_by       VARCHAR(255)    NOT NULL,
  PRIMARY KEY (id),
  KEY idx_statement_imports_period (period_end, period_start)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS bank_transactions (
  id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  import_id           BIGINT UNSIGNED NOT NULL,
  fitid               VARCHAR(128)    NOT NULL,
  posted_on           DATE            NOT NULL,
  amount_cents        INT             NOT NULL COMMENT 'Signed: credit > 0, debit < 0',
  description         VARCHAR(512)    NOT NULL DEFAULT '',
  reference           VARCHAR(255)    NULL,
  balance_cents       INT             NULL,
  raw_json            JSON            NOT NULL,
  status              ENUM('unmatched','matched','ignored') NOT NULL DEFAULT 'unmatched',
  matched_payment_id  BIGINT UNSIGNED NULL,
  ignore_reason       VARCHAR(255)    NULL,
  proposed_invoice_id BIGINT UNSIGNED NULL,
  proposed_confidence ENUM('high','medium','low') NULL,
  proposed_reason     VARCHAR(512)    NULL,
  created_at          DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at          DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_bank_transactions_fitid (fitid),
  KEY idx_bank_tx_status (status, posted_on),
  KEY idx_bank_tx_import (import_id),
  CONSTRAINT fk_bank_tx_import
    FOREIGN KEY (import_id) REFERENCES statement_imports (id),
  CONSTRAINT fk_bank_tx_payment
    FOREIGN KEY (matched_payment_id) REFERENCES payments (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
