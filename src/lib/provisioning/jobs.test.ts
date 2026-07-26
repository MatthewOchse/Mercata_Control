import { describe, expect, it } from "vitest";
import { splitSqlStatements } from "@/lib/db/migrate";
import fs from "node:fs";
import path from "node:path";

describe("020_provisioning_jobs migration", () => {
  it("splits cleanly (no COMMENT semicolons)", () => {
    const sql = fs.readFileSync(
      path.join(process.cwd(), "migrations/020_provisioning_jobs.sql"),
      "utf8",
    );
    const stmts = splitSqlStatements(sql);
    expect(stmts.length).toBeGreaterThanOrEqual(1);
    expect(stmts[0]).toMatch(/CREATE TABLE IF NOT EXISTS provisioning_jobs/);
    expect(stmts[0]).toMatch(/awaiting_env/);
    expect(stmts[0]).toMatch(/non_sensitive_config/);
    // Table must not have columns for credentials.
    expect(stmts[0]).not.toMatch(
      /\b(password|passphrase|fleet_secret|api_key)\b/i,
    );
  });
});
