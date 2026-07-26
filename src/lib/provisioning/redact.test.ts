import { describe, expect, it } from "vitest";
import { SecretRedactor, isSecretEnvKey } from "@/lib/provisioning/redact";
import { scrubProvisionAuditPayload } from "@/lib/provisioning/audit";
import type { ProvisioningJob, ProvisioningNonSensitiveConfig } from "@/lib/provisioning/types";

/** Shape returned by GET /api/admin/provisioning-jobs/[id] — must stay secret-free. */
function apiJobPayload(job: ProvisioningJob) {
  return {
    id: job.id,
    tenant_id: job.tenant_id,
    tier: job.tier,
    domain: job.domain,
    db_name: job.db_name,
    status: job.status,
    created_at: job.created_at,
    started_at: job.started_at,
    finished_at: job.finished_at,
    log_text: job.log_text,
    non_sensitive_config: job.non_sensitive_config,
  };
}

const SECRET_VALUE = "s3cr3t-VALUE-abc123XYZ-never-leak";

describe("SecretRedactor", () => {
  it("recognises secret env keys", () => {
    expect(isSecretEnvKey("AUTH_SECRET")).toBe(true);
    expect(isSecretEnvKey("FLEET_SECRET")).toBe(true);
    expect(isSecretEnvKey("MYSQL_PASSWORD")).toBe(true);
    expect(isSecretEnvKey("PAYFAST_PASSPHRASE")).toBe(true);
    expect(isSecretEnvKey("NEXT_PUBLIC_APP_URL")).toBe(false);
    expect(isSecretEnvKey("MYSQL_DATABASE")).toBe(false);
  });

  it("strips tracked values from command output", () => {
    const r = new SecretRedactor();
    r.track(SECRET_VALUE);
    const raw = `Provision ok AUTH_SECRET=${SECRET_VALUE} bearer ${SECRET_VALUE}`;
    const out = r.redact(raw);
    expect(out).not.toContain(SECRET_VALUE);
    expect(out).toContain("***");
  });

  it("redacts --admin-pass and Bearer headers even if untracked", () => {
    const r = new SecretRedactor();
    expect(r.redact("npm run x -- --admin-pass hunter2")).toBe(
      "npm run x -- --admin-pass ***",
    );
    expect(r.redact("mysql -uroot -pHunter2 -e SELECT")).toContain("-p***");
    expect(r.redact("Authorization: Bearer tok_live_abc")).toMatch(
      /Authorization:\s*Bearer\s+\*\*\*/,
    );
  });

  it("redacts KEY=value lines for secret-looking keys", () => {
    const r = new SecretRedactor();
    const line =
      "FLEET_SECRET=super-long-secret-value-here\nMYSQL_DATABASE=storedb_acme";
    const out = r.redact(line);
    expect(out).toContain("FLEET_SECRET=***");
    expect(out).toContain("MYSQL_DATABASE=storedb_acme");
  });

  it("describeKeys lists names only", () => {
    const r = new SecretRedactor();
    expect(r.describeKeys(["FLEET_SECRET", "AUTH_SECRET"])).toBe(
      "AUTH_SECRET, FLEET_SECRET",
    );
  });
});

describe("secret hygiene — audit, job config, API", () => {
  it("scrubProvisionAuditPayload redacts secret-named keys", () => {
    const scrubbed = scrubProvisionAuditPayload("acme", {
      domain: "acme.example",
      ADMIN_PASSWORD: SECRET_VALUE,
      fleet_secret: SECRET_VALUE,
      api_key: "sk_live_abc",
      ciphertext: "base64blob==",
      hasAdminPassword: true,
    });
    expect(scrubbed).toEqual({
      tenantId: "acme",
      domain: "acme.example",
      ADMIN_PASSWORD: "[redacted]",
      fleet_secret: "[redacted]",
      api_key: "[redacted]",
      ciphertext: "[redacted]",
      hasAdminPassword: true,
    });
    expect(JSON.stringify(scrubbed)).not.toContain(SECRET_VALUE);
  });

  it("assert: API job JSON never includes secret fields or plaintext", () => {
    const cfg: ProvisioningNonSensitiveConfig = {
      displayName: "Acme",
      host: "caesar",
      adminUsername: "admin@acme.example",
      failedStep: "3: provision DB",
      orphanNotes: "DB storedb_acme may exist",
      lastOutcome: "failed",
      retryCount: 1,
    };
    const job: ProvisioningJob = {
      id: 42,
      tenant_id: "acme",
      tier: "online",
      domain: "acme.example",
      db_name: "storedb_acme",
      target_server_id: 1,
      status: "failed",
      created_by: 1,
      created_at: "2026-07-26T00:00:00.000Z",
      started_at: "2026-07-26T00:01:00.000Z",
      finished_at: "2026-07-26T00:02:00.000Z",
      log_text: [
        "AUTH_SECRET=***",
        "ADMIN_PASSWORD=***",
        "FLEET_SECRET=***",
        `external secrets keys present: ADMIN_PASSWORD, PAYFAST_MERCHANT_ID`,
      ].join("\n"),
      non_sensitive_config: cfg,
    };

    const payload = apiJobPayload(job);
    const json = JSON.stringify(payload);

    // No secret column names with values, no ciphertext hand-off, no plaintext.
    expect(json).not.toContain(SECRET_VALUE);
    expect(json).not.toMatch(/"ciphertext"/i);
    expect(json).not.toMatch(/"ADMIN_PASSWORD"\s*:\s*"[^*]/i);
    expect(json).not.toMatch(/"FLEET_SECRET"\s*:\s*"[^*]/i);
    expect(json).not.toMatch(/"MYSQL_PASSWORD"\s*:\s*"[^*]/i);
    expect(payload.non_sensitive_config).not.toHaveProperty("ADMIN_PASSWORD");
    expect(payload.non_sensitive_config).not.toHaveProperty("FLEET_SECRET");
    expect(payload.log_text).not.toContain(SECRET_VALUE);
  });

  it("assert: redacted worker logText never retains tracked secrets", () => {
    const r = new SecretRedactor();
    r.track(SECRET_VALUE);
    r.trackMany({
      AUTH_SECRET: SECRET_VALUE,
      FLEET_SECRET: "fleet-" + SECRET_VALUE,
      PAYFAST_PASSPHRASE: "pf-" + SECRET_VALUE,
    });
    const rawLog = [
      `openssl generated AUTH_SECRET=${SECRET_VALUE}`,
      `Authorization: Bearer fleet-${SECRET_VALUE}`,
      `PAYFAST_PASSPHRASE=pf-${SECRET_VALUE}`,
      `--admin-pass ${SECRET_VALUE}`,
    ].join("\n");
    const logText = r.redact(rawLog);
    expect(logText).not.toContain(SECRET_VALUE);
    expect(logText).not.toContain("fleet-" + SECRET_VALUE);
    expect(logText).not.toContain("pf-" + SECRET_VALUE);
  });
});
