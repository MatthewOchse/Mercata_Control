import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { splitSqlStatements } from "@/lib/db/migrate";
import { CAESAR_SERVER_SEED } from "@/lib/servers/types";

describe("022_server_host_fields migration", () => {
  it("adds id + host fields and seeds Caesar without touching tenant_infra", () => {
    const sql = fs.readFileSync(
      path.join(process.cwd(), "migrations/022_server_host_fields.sql"),
      "utf8",
    );
    const stmts = splitSqlStatements(sql);
    expect(stmts.length).toBeGreaterThanOrEqual(2);
    expect(sql).toMatch(/ADD COLUMN id\b/);
    expect(sql).toMatch(/public_ip/);
    expect(sql).toMatch(/db_host/);
    expect(sql).toMatch(/db_port/);
    expect(sql).toMatch(/deploy_path/);
    expect(sql).toMatch(/ux_servers_name/);
    expect(sql).toContain(CAESAR_SERVER_SEED.publicIp);
    expect(sql).toContain(CAESAR_SERVER_SEED.deployPath);
    expect(sql).toContain("'caesar'");
    // Must not mutate tenants or infra placement (comments mentioning the link are fine).
    expect(sql).not.toMatch(/\b(UPDATE|INSERT INTO|DELETE FROM)\s+tenant_infra\b/i);
    expect(sql).not.toMatch(/\b(UPDATE|INSERT INTO|DELETE FROM)\s+tenants\b/i);
    expect(sql).not.toMatch(/provisioning_jobs/i);
  });
});
