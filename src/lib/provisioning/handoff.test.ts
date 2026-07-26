import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { splitSqlStatements } from "@/lib/db/migrate";

describe("021_provisioning_secrets_handoff migration", () => {
  it("creates secrets table and operators.is_super", () => {
    const sql = fs.readFileSync(
      path.join(
        process.cwd(),
        "migrations/021_provisioning_secrets_handoff.sql",
      ),
      "utf8",
    );
    const stmts = splitSqlStatements(sql);
    expect(stmts.some((s) => /provisioning_job_secrets/.test(s))).toBe(true);
    expect(stmts.some((s) => /is_super/.test(s))).toBe(true);
    expect(sql).toMatch(/ciphertext/);
    expect(sql).not.toMatch(/\bpassword_hash\b/i);
  });
});
