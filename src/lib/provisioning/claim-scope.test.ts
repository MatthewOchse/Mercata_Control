import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { splitSqlStatements } from "@/lib/db/migrate";

describe("024 target_server_id + host-scoped claim", () => {
  it("migration requires target_server_id and back-fills Caesar", () => {
    const sql = fs.readFileSync(
      path.join(process.cwd(), "migrations/024_provisioning_job_server_id.sql"),
      "utf8",
    );
    expect(splitSqlStatements(sql).length).toBeGreaterThanOrEqual(3);
    expect(sql).toMatch(/ADD COLUMN target_server_id/);
    expect(sql).toMatch(/MODIFY COLUMN target_server_id BIGINT UNSIGNED NOT NULL/);
    expect(sql).toMatch(/name = 'caesar'/);
    expect(sql).toMatch(/fk_provisioning_jobs_target_server/);
  });

  it("claim SQL scopes to target_server_id (Caesar picks own, ignores others)", () => {
    const jobsSrc = fs.readFileSync(
      path.join(process.cwd(), "src/lib/provisioning/jobs.ts"),
      "utf8",
    );
    expect(jobsSrc).toMatch(
      /WHERE status = 'queued'\s+AND target_server_id = :serverId/,
    );
    expect(jobsSrc).toMatch(
      /AND target_server_id = :serverId\s+AND started_at IS NOT NULL/,
    );

    const workerSrc = fs.readFileSync(
      path.join(process.cwd(), "workers/provision-worker.ts"),
      "utf8",
    );
    expect(workerSrc).toMatch(/MERCATA_SERVER_ID/);
    expect(workerSrc).toMatch(/claimNextQueuedJob\(MERCATA_SERVER_ID\)/);
    expect(workerSrc).toMatch(
      /reclaimStaleRunningJobs\(\s*STALE_MINUTES,\s*MERCATA_SERVER_ID/,
    );
    expect(workerSrc).toMatch(
      /job\.target_server_id !== MERCATA_SERVER_ID/,
    );

    const envExample = fs.readFileSync(
      path.join(process.cwd(), "deploy/systemd/env.worker.example"),
      "utf8",
    );
    expect(envExample).toMatch(/^MERCATA_SERVER_ID=1$/m);
  });
});
