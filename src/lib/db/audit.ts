import type { PoolConnection, ResultSetHeader } from "mysql2/promise";

export type AuditEntry = {
  actor: string;
  action: string;
  entityType: string;
  entityId: string | number;
  before?: unknown;
  after?: unknown;
};

export async function writeAuditLog(
  conn: PoolConnection | { execute: PoolConnection["execute"] },
  entry: AuditEntry,
): Promise<void> {
  await conn.execute<ResultSetHeader>(
    `INSERT INTO audit_log (actor, action, entity_type, entity_id, before_json, after_json)
     VALUES (?, ?, ?, ?, CAST(? AS JSON), CAST(? AS JSON))`,
    [
      entry.actor,
      entry.action,
      entry.entityType,
      String(entry.entityId),
      entry.before === undefined ? null : JSON.stringify(entry.before),
      entry.after === undefined ? null : JSON.stringify(entry.after),
    ],
  );
}
