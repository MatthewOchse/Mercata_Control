import fs from "node:fs";
import path from "node:path";
import type { Connection, RowDataPacket } from "mysql2/promise";

/** Split a SQL dump into executable statements, honouring -- comments. */
export function splitSqlStatements(sql: string): string[] {
  const statements: string[] = [];
  let buffer = "";

  for (const rawLine of sql.split(/\r?\n/)) {
    const commentIdx = rawLine.indexOf("--");
    const line =
      commentIdx === -1 ? rawLine : rawLine.slice(0, commentIdx);
    buffer += `${line}\n`;

    let idx = buffer.indexOf(";");
    while (idx !== -1) {
      const chunk = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (chunk) statements.push(chunk);
      idx = buffer.indexOf(";");
    }
  }

  const tail = buffer.trim();
  if (tail) statements.push(tail);
  return statements;
}

export async function ensureSchemaMigrationsTable(
  conn: Connection,
): Promise<void> {
  await conn.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      migration_id VARCHAR(64)  NOT NULL,
      applied_at   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (migration_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
}

export function migrationsDir(): string {
  return path.join(process.cwd(), "migrations");
}

export function listMigrationFiles(): string[] {
  const dir = migrationsDir();
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => /^\d{3}_.+\.sql$/i.test(f))
    .sort((a, b) => a.localeCompare(b));
}

export function migrationIdFromFilename(filename: string): string {
  return filename.replace(/\.sql$/i, "");
}

export async function getAppliedMigrationIds(
  conn: Connection,
): Promise<Set<string>> {
  await ensureSchemaMigrationsTable(conn);
  const [rows] = await conn.execute<RowDataPacket[]>(
    `SELECT migration_id FROM schema_migrations ORDER BY migration_id`,
  );
  return new Set(rows.map((r) => String(r.migration_id)));
}

export async function recordMigration(
  conn: Connection,
  migrationId: string,
): Promise<void> {
  await conn.execute(
    `INSERT INTO schema_migrations (migration_id) VALUES (?)
     ON DUPLICATE KEY UPDATE applied_at = applied_at`,
    [migrationId],
  );
}

export async function executeSqlScript(
  conn: Connection,
  sql: string,
): Promise<void> {
  for (const stmt of splitSqlStatements(sql)) {
    await conn.query(stmt);
  }
}

export type MigrateResult = {
  applied: string[];
  skipped: string[];
};

export async function migrateDatabase(conn: Connection): Promise<MigrateResult> {
  const applied: string[] = [];
  const skipped: string[] = [];
  const done = await getAppliedMigrationIds(conn);

  for (const file of listMigrationFiles()) {
    const migrationId = migrationIdFromFilename(file);
    if (done.has(migrationId)) {
      skipped.push(migrationId);
      continue;
    }

    const filePath = path.join(migrationsDir(), file);
    const sql = fs.readFileSync(filePath, "utf8");
    await executeSqlScript(conn, sql);
    await recordMigration(conn, migrationId);
    applied.push(migrationId);
    done.add(migrationId);
  }

  return { applied, skipped };
}
