#!/usr/bin/env tsx
/**
 * Apply pending migrations/*.sql files.
 * Usage: npm run db:migrate
 */
import "dotenv/config";
import mysql from "mysql2/promise";
import { migrateDatabase } from "../src/lib/db/migrate";

async function main() {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) {
    console.error("DATABASE_URL is required");
    process.exit(1);
  }

  const conn = await mysql.createConnection(url);
  try {
    const result = await migrateDatabase(conn);
    console.log(
      `Migrations complete — applied: [${result.applied.join(", ") || "none"}], skipped: [${result.skipped.join(", ") || "none"}]`,
    );
  } finally {
    await conn.end();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
