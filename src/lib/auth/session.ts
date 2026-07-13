import { createHash, randomBytes } from "node:crypto";
import type { RowDataPacket } from "mysql2/promise";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { verifyTotp } from "@/lib/auth/totp";
import { writeAuditLog } from "@/lib/db/audit";
import { execute, query, withTransaction } from "@/lib/db/pool";

export const SESSION_COOKIE = "mercata_session";
export const SESSION_TTL_MS = 1000 * 60 * 60 * 12; // 12 hours

export type Operator = {
  id: number;
  email: string;
  display_name: string;
  totp_confirmed: number;
};

type OperatorRow = Operator &
  RowDataPacket & {
    password_hash: string;
    totp_secret: string;
  };

type SessionRow = RowDataPacket & {
  id: string;
  operator_id: number;
  token_hash: string;
  expires_at: Date;
  email: string;
  display_name: string;
  totp_confirmed: number;
};

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function newSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

export async function findOperatorByEmail(
  email: string,
): Promise<OperatorRow | null> {
  const rows = await query<OperatorRow[]>(
    `SELECT id, email, password_hash, totp_secret, totp_confirmed, display_name
     FROM operators WHERE email = :email LIMIT 1`,
    { email: email.trim().toLowerCase() },
  );
  return rows[0] ?? null;
}

export async function createSession(opts: {
  operatorId: number;
  userAgent?: string | null;
  ip?: string | null;
}): Promise<{ sessionId: string; token: string; expiresAt: Date }> {
  const sessionId = crypto.randomUUID();
  const token = newSessionToken();
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

  await execute(
    `INSERT INTO sessions (id, operator_id, token_hash, expires_at, user_agent, ip)
     VALUES (:id, :operatorId, :tokenHash, :expiresAt, :userAgent, :ip)`,
    {
      id: sessionId,
      operatorId: opts.operatorId,
      tokenHash,
      expiresAt,
      userAgent: opts.userAgent ?? null,
      ip: opts.ip ?? null,
    },
  );

  return { sessionId, token, expiresAt };
}

export async function getSessionOperator(
  token: string | undefined | null,
): Promise<Operator | null> {
  if (!token) return null;
  const tokenHash = hashToken(token);
  const rows = await query<SessionRow[]>(
    `SELECT s.id, s.operator_id, s.token_hash, s.expires_at,
            o.email, o.display_name, o.totp_confirmed
     FROM sessions s
     INNER JOIN operators o ON o.id = s.operator_id
     WHERE s.token_hash = :tokenHash
     LIMIT 1`,
    { tokenHash },
  );
  const row = rows[0];
  if (!row) return null;
  if (new Date(row.expires_at).getTime() <= Date.now()) {
    await destroySession(token);
    return null;
  }

  await execute(
    `UPDATE sessions SET last_seen_at = UTC_TIMESTAMP(3) WHERE id = :id`,
    { id: row.id },
  );

  return {
    id: row.operator_id,
    email: row.email,
    display_name: row.display_name,
    totp_confirmed: row.totp_confirmed,
  };
}

export async function destroySession(token: string): Promise<void> {
  const tokenHash = hashToken(token);
  await execute(`DELETE FROM sessions WHERE token_hash = :tokenHash`, {
    tokenHash,
  });
}

export async function loginWithPasswordAndTotp(opts: {
  email: string;
  password: string;
  totp: string;
  userAgent?: string | null;
  ip?: string | null;
}): Promise<
  | { operator: Operator; token: string; expiresAt: Date }
  | { error: string }
> {
  const operator = await findOperatorByEmail(opts.email);
  if (!operator) {
    return { error: "Invalid email, password, or authenticator code." };
  }

  const passwordOk = await verifyPassword(
    operator.password_hash,
    opts.password,
  );
  if (!passwordOk) {
    return { error: "Invalid email, password, or authenticator code." };
  }

  if (!operator.totp_confirmed) {
    return { error: "Operator TOTP is not confirmed. Re-run the seed script." };
  }

  if (!verifyTotp(operator.totp_secret, opts.totp)) {
    return { error: "Invalid email, password, or authenticator code." };
  }

  const session = await createSession({
    operatorId: operator.id,
    userAgent: opts.userAgent,
    ip: opts.ip,
  });

  await withTransaction(async (conn) => {
    await writeAuditLog(conn, {
      actor: operator.email,
      action: "login",
      entityType: "operator",
      entityId: operator.id,
      after: { session_id: session.sessionId },
    });
  });

  return {
    operator: {
      id: operator.id,
      email: operator.email,
      display_name: operator.display_name,
      totp_confirmed: operator.totp_confirmed,
    },
    token: session.token,
    expiresAt: session.expiresAt,
  };
}

export { hashPassword };
