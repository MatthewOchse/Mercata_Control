-- Login lockout / rate-limit state (fail2ban-style).
-- Recorded via schema_migrations — do not edit after apply.

CREATE TABLE IF NOT EXISTS login_attempts (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  attempt_key     CHAR(64)        NOT NULL COMMENT 'sha256(ip|email)',
  ip              VARCHAR(45)     NOT NULL,
  email           VARCHAR(255)    NOT NULL,
  failed_count    INT UNSIGNED    NOT NULL DEFAULT 0,
  first_failed_at DATETIME(3)     NULL,
  locked_until    DATETIME(3)     NULL,
  updated_at      DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
                                    ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY ux_login_attempts_key (attempt_key),
  KEY ix_login_attempts_locked (locked_until)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
