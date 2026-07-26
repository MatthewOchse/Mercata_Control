import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { splitSqlStatements } from "@/lib/db/migrate";

describe("023_tenant_server_id migration", () => {
  it("adds required server_id, back-fills Caesar, leaves infra untouched", () => {
    const sql = fs.readFileSync(
      path.join(process.cwd(), "migrations/023_tenant_server_id.sql"),
      "utf8",
    );
    const stmts = splitSqlStatements(sql);
    expect(stmts.length).toBeGreaterThanOrEqual(3);
    expect(sql).toMatch(/ADD COLUMN server_id/);
    expect(sql).toMatch(/UPDATE tenants[\s\S]*server_id[\s\S]*caesar/);
    expect(sql).toMatch(/MODIFY COLUMN server_id BIGINT UNSIGNED NOT NULL/);
    expect(sql).toMatch(/fk_tenants_server/);
    expect(sql).toMatch(/REFERENCES servers \(id\)/);
    // Must not rewrite placement / secrets / containers.
    expect(sql).not.toMatch(
      /\b(UPDATE|INSERT INTO|DELETE FROM)\s+tenant_infra\b/i,
    );
    expect(sql).not.toMatch(/\bfleet_secret\b/);
    expect(sql).not.toMatch(/\bcontainer_name\b/);
  });
});
