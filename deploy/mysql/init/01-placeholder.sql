-- Runs once on first MySQL volume init.
-- App user: full DML on mercata_control EXCEPT audit_log is append-only
-- (SELECT + INSERT only — no UPDATE / DELETE).

CREATE DATABASE IF NOT EXISTS mercata_control
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- MYSQL_USER is created by the official image; tighten audit_log after tables exist.
-- Migrations create audit_log; grants are re-applied by deploy/mysql/apply-grants.sh
-- after migrate. This file documents the intended privilege model.

-- Placeholder so initdir is non-empty on first boot.
SELECT 1;
