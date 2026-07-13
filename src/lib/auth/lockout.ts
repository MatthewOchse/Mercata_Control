import { createHash } from "node:crypto";
import type { RowDataPacket } from "mysql2/promise";
import { execute, query } from "@/lib/db/pool";

/** Failures before lockout. */
export const LOGIN_MAX_FAILURES = 5;
/** Lock duration after threshold (minutes). */
export const LOGIN_LOCKOUT_MINUTES = 15;
/** Sliding window for counting failures (minutes). */
export const LOGIN_FAILURE_WINDOW_MINUTES = 15;

type AttemptRow = RowDataPacket & {
  failed_count: number;
  first_failed_at: Date | string | null;
  locked_until: Date | string | null;
};

function attemptKey(ip: string, email: string): string {
  return createHash("sha256")
    .update(`${ip}|${email.trim().toLowerCase()}`)
    .digest("hex");
}

function asDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  return value instanceof Date ? value : new Date(value);
}

export async function getLoginLockStatus(
  ip: string,
  email: string,
): Promise<{ locked: boolean; retryAfterSeconds?: number }> {
  const key = attemptKey(ip || "unknown", email || "");
  const rows = await query<AttemptRow[]>(
    `SELECT failed_count, first_failed_at, locked_until
     FROM login_attempts WHERE attempt_key = :key LIMIT 1`,
    { key },
  );
  const row = rows[0];
  if (!row) return { locked: false };

  const lockedUntil = asDate(row.locked_until);
  if (lockedUntil && lockedUntil.getTime() > Date.now()) {
    return {
      locked: true,
      retryAfterSeconds: Math.ceil(
        (lockedUntil.getTime() - Date.now()) / 1000,
      ),
    };
  }
  return { locked: false };
}

export async function recordLoginFailure(
  ip: string,
  email: string,
): Promise<{ locked: boolean; retryAfterSeconds?: number }> {
  const key = attemptKey(ip || "unknown", email || "");
  const normEmail = email.trim().toLowerCase() || "(blank)";
  const normIp = ip || "unknown";

  await execute(
    `INSERT INTO login_attempts (attempt_key, ip, email, failed_count, first_failed_at)
     VALUES (:key, :ip, :email, 1, UTC_TIMESTAMP(3))
     ON DUPLICATE KEY UPDATE
       ip = VALUES(ip),
       email = VALUES(email),
       failed_count = IF(
         locked_until IS NOT NULL AND locked_until > UTC_TIMESTAMP(3),
         failed_count,
         IF(
           first_failed_at IS NULL
             OR first_failed_at < (UTC_TIMESTAMP(3) - INTERVAL ${LOGIN_FAILURE_WINDOW_MINUTES} MINUTE),
           1,
           failed_count + 1
         )
       ),
       first_failed_at = IF(
         locked_until IS NOT NULL AND locked_until > UTC_TIMESTAMP(3),
         first_failed_at,
         IF(
           first_failed_at IS NULL
             OR first_failed_at < (UTC_TIMESTAMP(3) - INTERVAL ${LOGIN_FAILURE_WINDOW_MINUTES} MINUTE),
           UTC_TIMESTAMP(3),
           first_failed_at
         )
       ),
       locked_until = IF(
         locked_until IS NOT NULL AND locked_until > UTC_TIMESTAMP(3),
         locked_until,
         IF(
           IF(
             first_failed_at IS NULL
               OR first_failed_at < (UTC_TIMESTAMP(3) - INTERVAL ${LOGIN_FAILURE_WINDOW_MINUTES} MINUTE),
             1,
             failed_count + 1
           ) >= ${LOGIN_MAX_FAILURES},
           UTC_TIMESTAMP(3) + INTERVAL ${LOGIN_LOCKOUT_MINUTES} MINUTE,
           NULL
         )
       )`,
    { key, ip: normIp, email: normEmail },
  );

  return getLoginLockStatus(normIp, normEmail);
}

export async function clearLoginFailures(
  ip: string,
  email: string,
): Promise<void> {
  const key = attemptKey(ip || "unknown", email || "");
  await execute(`DELETE FROM login_attempts WHERE attempt_key = :key`, { key });
}
