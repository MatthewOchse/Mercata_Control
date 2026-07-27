import fs from "node:fs";
import path from "node:path";
import { query } from "@/lib/db/pool";
import type { RowDataPacket } from "mysql2/promise";
import type { ProvisioningJob } from "@/lib/provisioning/types";
import type { ProvisionHostTarget } from "@/lib/provisioning/host";
import { SecretRedactor } from "@/lib/provisioning/redact";
import {
  generateInternalSecrets,
  loadExternalSecrets,
  readEnvFile,
  resolveAdminPassword,
  writeTenantEnvAssembled,
} from "@/lib/provisioning/secrets";
import { formatCmd, runShell } from "@/lib/provisioning/shell";
import { runMysqlCli } from "@/lib/provisioning/mysql-cli";

export type ProvisionOutcome = "succeeded" | "awaiting_env" | "failed";

export type ProvisionRoutineContext = {
  job: ProvisioningJob;
  /** Host paths/params resolved from the job's Server row. */
  host: ProvisionHostTarget;
  log: (line: string) => Promise<void>;
};

const RESERVED_TENANT_IDS = new Set(["crafties", "demo-online", "geist"]);

const DEFAULT_CATEGORIES = [
  { name: "General", markup: "0.00" },
  { name: "Uncategorised", markup: "0.00" },
];

function tenantEnvPath(host: ProvisionHostTarget, tenantId: string): string {
  return path.join(host.deployRoot, "tenants", tenantId, ".env");
}

function containerName(tenantId: string): string {
  return `tenant-${tenantId}`;
}

function publicOrigin(domain: string): string {
  const scheme = domain.includes("localhost") ? "http" : "https";
  return `${scheme}://${domain}`;
}

function assertSlug(tenantId: string): void {
  if (!/^[a-z][a-z0-9-]{0,31}$/.test(tenantId)) {
    throw new Error(
      `tenant id "${tenantId}" is not slug-safe (^[a-z][a-z0-9-]{0,31}$)`,
    );
  }
  if (RESERVED_TENANT_IDS.has(tenantId)) {
    throw new Error(
      `tenant id "${tenantId}" is reserved (committed static seed)`,
    );
  }
}

function assertDomain(domain: string): void {
  const d = domain.trim().toLowerCase();
  if (!d || /\s/.test(d) || !/^[a-z0-9.-]+\.[a-z0-9.-]+$/.test(d)) {
    throw new Error(`domain "${domain}" is not well-formed`);
  }
}

function assertDbName(dbName: string): void {
  if (!/^[A-Za-z0-9_]{1,64}$/.test(dbName)) {
    throw new Error(
      `db name "${dbName}" is unsafe (use 1–64 chars [A-Za-z0-9_])`,
    );
  }
}

async function assertTenantIdUnique(
  tenantId: string,
  currentJobId: number,
): Promise<void> {
  const rows = await query<RowDataPacket[]>(
    `SELECT id, status FROM provisioning_jobs
     WHERE tenant_id = :tenantId
       AND id <> :currentJobId
       AND status IN ('queued', 'running', 'succeeded', 'awaiting_env')
     ORDER BY id DESC
     LIMIT 5`,
    { tenantId, currentJobId },
  );
  if (rows.length > 0) {
    const sample = rows
      .map((r) => `#${r.id}:${r.status}`)
      .join(", ");
    throw new Error(
      `tenant id "${tenantId}" already has active/completed job(s): ${sample}`,
    );
  }

  const adminTenants = await query<RowDataPacket[]>(
    `SELECT id FROM tenants WHERE slug = :slug LIMIT 1`,
    { slug: tenantId },
  );
  if (adminTenants.length > 0) {
    throw new Error(
      `tenant slug "${tenantId}" already exists in admin tenants table`,
    );
  }
}

async function logShell(
  ctx: ProvisionRoutineContext,
  redactor: SecretRedactor,
  label: string,
  result: { code: number; stdout: string; stderr: string },
): Promise<void> {
  if (result.stdout.trim()) {
    await ctx.log(`${label} stdout:\n${redactor.redact(result.stdout).trimEnd()}`);
  }
  if (result.stderr.trim()) {
    await ctx.log(`${label} stderr:\n${redactor.redact(result.stderr).trimEnd()}`);
  }
  await ctx.log(`${label} exit=${result.code}`);
}

async function cleanupTenantContainer(
  ctx: ProvisionRoutineContext,
  redactor: SecretRedactor,
): Promise<void> {
  const tenantId = ctx.job.tenant_id;
  const compose = ctx.host.composeFile;
  const service = tenantId;
  await ctx.log(
    `cleanup: stopping/removing compose service ${service} (container ${containerName(tenantId)})`,
  );
  const stop = await runShell({
    cmd: "docker",
    args: ["compose", "-f", compose, "stop", service],
    cwd: ctx.host.composeCwd,
    redactor,
    timeoutMs: 60_000,
  });
  await logShell(ctx, redactor, "docker compose stop", stop);

  const rm = await runShell({
    cmd: "docker",
    args: ["compose", "-f", compose, "rm", "-f", service],
    cwd: ctx.host.composeCwd,
    redactor,
    timeoutMs: 60_000,
  });
  await logShell(ctx, redactor, "docker compose rm", rm);
  await ctx.log(
    "MANUAL ATTENTION: DB/registry may still exist — inspect before re-running. Container removed.",
  );
}

async function stepValidate(ctx: ProvisionRoutineContext): Promise<void> {
  const { job } = ctx;
  assertSlug(job.tenant_id);
  assertDomain(job.domain);
  assertDbName(job.db_name);
  if (job.tier !== "online" && job.tier !== "retail") {
    throw new Error(`invalid tier "${job.tier}"`);
  }
  await assertTenantIdUnique(job.tenant_id, job.id);
  if (!fs.existsSync(ctx.host.fleetRepoRoot)) {
    throw new Error(
      `deploy path does not exist on ${ctx.host.serverName}: ${ctx.host.fleetRepoRoot}`,
    );
  }
  await ctx.log(
    `host=${ctx.host.serverName} (#${ctx.host.serverId}) ` +
      `deploy=${ctx.host.fleetRepoRoot} db=${ctx.host.provisionDbHost}:${ctx.host.provisionDbPort} ` +
      `publicIp=${ctx.host.publicIp} compose=${ctx.host.composeFile} caddy=${ctx.host.caddyFile}`,
  );
  await ctx.log(
    `DNS guidance: point A/AAAA for ${job.domain} → ${ctx.host.publicIp}`,
  );
  await ctx.log(
    `validated id=${job.tenant_id} tier=${job.tier} domain=${job.domain} db=${job.db_name}`,
  );
}

async function stepGenerateInternalSecrets(
  ctx: ProvisionRoutineContext,
  redactor: SecretRedactor,
): Promise<{ AUTH_SECRET: string; STORE_ADMIN_SECRET: string; FLEET_SECRET: string }> {
  const envPath = tenantEnvPath(ctx.host, ctx.job.tenant_id);
  const existing = readEnvFile(envPath, redactor);

  const reuse = (key: string) => existing.get(key)?.trim() || "";

  let auth = reuse("AUTH_SECRET") || reuse("NEXTAUTH_SECRET");
  let store = reuse("STORE_ADMIN_SECRET") || reuse("CRAFTIES_ADMIN_SECRET");
  let fleet = reuse("FLEET_SECRET");

  if (auth && store && fleet) {
    redactor.trackMany({
      AUTH_SECRET: auth,
      STORE_ADMIN_SECRET: store,
      FLEET_SECRET: fleet,
    });
    await ctx.log(
      "internal secrets: reused existing AUTH_SECRET, STORE_ADMIN_SECRET, FLEET_SECRET from .env (keys only)",
    );
    return {
      AUTH_SECRET: auth,
      STORE_ADMIN_SECRET: store,
      FLEET_SECRET: fleet,
    };
  }

  const generated = generateInternalSecrets(redactor);
  auth = auth || generated.AUTH_SECRET;
  store = store || generated.STORE_ADMIN_SECRET;
  fleet = fleet || generated.FLEET_SECRET;
  redactor.trackMany({
    AUTH_SECRET: auth,
    STORE_ADMIN_SECRET: store,
    FLEET_SECRET: fleet,
  });
  await ctx.log(
    "internal secrets: generated via openssl rand -base64 32 for missing keys: " +
      [
        !reuse("AUTH_SECRET") && !reuse("NEXTAUTH_SECRET") ? "AUTH_SECRET" : null,
        !reuse("STORE_ADMIN_SECRET") && !reuse("CRAFTIES_ADMIN_SECRET")
          ? "STORE_ADMIN_SECRET"
          : null,
        !reuse("FLEET_SECRET") ? "FLEET_SECRET" : null,
      ]
        .filter(Boolean)
        .join(", "),
  );
  return {
    AUTH_SECRET: auth,
    STORE_ADMIN_SECRET: store,
    FLEET_SECRET: fleet,
  };
}

async function databaseLikelyExists(
  ctx: ProvisionRoutineContext,
  redactor: SecretRedactor,
): Promise<boolean> {
  // Best-effort: ask MySQL via the provision credentials if available.
  const host = ctx.host.provisionDbHost;
  const user =
    process.env.PROVISION_MYSQL_USER || process.env.MYSQL_USER || "root";
  const password =
    process.env.PROVISION_MYSQL_PASSWORD || process.env.MYSQL_PASSWORD || "";
  redactor.track(password);

  try {
    const result = await runMysqlCli({
      host,
      port: ctx.host.provisionDbPort,
      user,
      password,
      sqlArgs: [
        "-N",
        "-e",
        `SELECT COUNT(*) FROM information_schema.SCHEMATA WHERE SCHEMA_NAME='${ctx.job.db_name.replace(/'/g, "")}'`,
      ],
      cwd: ctx.host.fleetRepoRoot,
      redactor,
      timeoutMs: 30_000,
    });
    if (result.code !== 0) {
      await ctx.log(
        "db-exists probe inconclusive (mysql client failed) — will try provision",
      );
      return false;
    }
    return result.stdout.trim() === "1";
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await ctx.log(
      `db-exists probe inconclusive (${redactor.redact(msg)}) — will try provision`,
    );
    return false;
  }
}

async function stepTenantProvision(
  ctx: ProvisionRoutineContext,
  redactor: SecretRedactor,
  adminPassword: string,
): Promise<void> {
  const { job } = ctx;
  const adminUser =
    job.non_sensitive_config?.adminUsername?.trim() ||
    `admin@${job.domain}`;

  const exists = await databaseLikelyExists(ctx, redactor);
  if (exists) {
    await ctx.log(
      `database ${job.db_name} already exists — skipping tenant:provision (idempotent)`,
    );
    // Ensure registry + deploy artifacts via attach (safe for existing DB).
    const args = [
      "run",
      "tenant:attach",
      "--",
      job.tenant_id,
      "--confirm-existing-data",
      "--tier",
      job.tier,
      "--domain",
      job.domain,
      "--db-name",
      job.db_name,
    ];
    await ctx.log(formatCmd("npm", args, redactor));
    const result = await runShell({
      cmd: "npm",
      args,
      cwd: ctx.host.fleetRepoRoot,
      redactor,
      timeoutMs: 300_000,
      env: {
        PROVISION_ADMIN_USERNAME: undefined,
        PROVISION_ADMIN_PASSWORD: undefined,
      },
    });
    await logShell(ctx, redactor, "tenant:attach", result);
    if (result.code !== 0) {
      throw new Error("tenant:attach failed");
    }
    return;
  }

  const args = [
    "run",
    "tenant:provision",
    "--",
    job.tenant_id,
    "--tier",
    job.tier,
    "--domain",
    job.domain,
    "--db-name",
    job.db_name,
    "--admin-user",
    adminUser,
    "--admin-pass",
    adminPassword,
  ];
  if (job.non_sensitive_config?.displayName) {
    args.push("--display-name", job.non_sensitive_config.displayName);
  }

  await ctx.log(
    formatCmd("npm", args, redactor) +
      ` (admin-user=${adminUser}; admin-pass redacted)`,
  );

  const result = await runShell({
    cmd: "npm",
    args,
    cwd: ctx.host.fleetRepoRoot,
    redactor,
    timeoutMs: 600_000,
  });
  await logShell(ctx, redactor, "tenant:provision", result);
  if (result.code !== 0) {
    throw new Error("tenant:provision failed");
  }

  await seedDefaultCategories(ctx, redactor);
}

async function seedDefaultCategories(
  ctx: ProvisionRoutineContext,
  redactor: SecretRedactor,
): Promise<void> {
  const host = ctx.host.provisionDbHost;
  const user =
    process.env.PROVISION_MYSQL_USER || process.env.MYSQL_USER || "root";
  const password =
    process.env.PROVISION_MYSQL_PASSWORD || process.env.MYSQL_PASSWORD || "";
  redactor.track(password);

  const values = DEFAULT_CATEGORIES.map(
    (c) => `('${c.name.replace(/'/g, "''")}', ${c.markup})`,
  ).join(", ");
  const sql =
    `INSERT IGNORE INTO \`${ctx.job.db_name.replace(/`/g, "")}\`.stock_categories (name, markup) ` +
    `VALUES ${values}`;

  await ctx.log(
    `seeding default categories: ${DEFAULT_CATEGORIES.map((c) => c.name).join(", ")}`,
  );
  try {
    const result = await runMysqlCli({
      host,
      port: ctx.host.provisionDbPort,
      user,
      password,
      sqlArgs: ["-e", sql],
      cwd: ctx.host.fleetRepoRoot,
      redactor,
      timeoutMs: 30_000,
    });
    await logShell(ctx, redactor, "seed categories", result);
    if (result.code !== 0) {
      await ctx.log(
        "WARN: category seed failed (non-fatal if table/permissions differ)",
      );
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await ctx.log(
      `WARN: category seed skipped (${redactor.redact(msg)})`,
    );
  }
}

async function stepAssembleEnv(
  ctx: ProvisionRoutineContext,
  redactor: SecretRedactor,
  internal: {
    AUTH_SECRET: string;
    STORE_ADMIN_SECRET: string;
    FLEET_SECRET: string;
  },
  external: Record<string, string | undefined>,
): Promise<void> {
  const { job } = ctx;
  const origin = publicOrigin(job.domain);
  const envPath = tenantEnvPath(ctx.host, job.tenant_id);

  const values: Record<string, string> = {
    TENANT_ID: job.tenant_id,
    TENANT_CONFIG_DIR: "/config/runtime",
    NODE_ENV: "production",
    MYSQL_HOST:
      external.MYSQL_HOST?.trim() ||
      process.env.TENANT_MYSQL_HOST?.trim() ||
      ctx.host.containerMysqlHost,
    MYSQL_PORT: external.MYSQL_PORT?.trim() || "3306",
    MYSQL_DATABASE: job.db_name,
    MYSQL_USER:
      external.MYSQL_USER?.trim() ||
      process.env.MYSQL_USER?.trim() ||
      "root",
    MYSQL_PASSWORD:
      external.MYSQL_PASSWORD?.trim() ||
      process.env.MYSQL_PASSWORD?.trim() ||
      "",
    AUTH_URL: origin,
    NEXTAUTH_URL: origin,
    NEXT_PUBLIC_APP_URL: origin,
    AUTH_SECRET: internal.AUTH_SECRET,
    NEXTAUTH_SECRET: internal.AUTH_SECRET,
    STORE_ADMIN_SECRET: internal.STORE_ADMIN_SECRET,
    CRAFTIES_ADMIN_SECRET: internal.STORE_ADMIN_SECRET,
    FLEET_SECRET: internal.FLEET_SECRET,
  };

  // Pass through operator external secrets (PayFast, SMTP, …) by env key name.
  for (const [key, value] of Object.entries(external)) {
    if (!value?.trim()) continue;
    if (key === "ADMIN_PASSWORD" || key === "ADMIN_EMAIL") continue;
    if (key in values && values[key]) continue; // prefer already set
    values[key] = value.trim();
  }

  redactor.trackMany(values);
  const keys = writeTenantEnvAssembled({ envPath, values, redactor });
  await ctx.log(
    `assembled ${envPath} with keys: ${redactor.describeKeys(keys)} (values redacted)`,
  );
}

async function stepMaterializeFleet(
  ctx: ProvisionRoutineContext,
  redactor: SecretRedactor,
): Promise<void> {
  const tenantId = ctx.job.tenant_id;

  // materialize-config from platform DB (works for any id after registry upsert)
  const matArgs = [
    "scripts/materialize-config.mjs",
    tenantId,
  ];
  await ctx.log(formatCmd("node", matArgs, redactor));
  const mat = await runShell({
    cmd: "node",
    args: matArgs,
    cwd: ctx.host.fleetRepoRoot,
    redactor,
    timeoutMs: 120_000,
  });
  await logShell(ctx, redactor, "materialize-config", mat);
  if (mat.code !== 0) {
    throw new Error("materialize-config failed");
  }

  // Copy runtime JSON into deploy/tenants/<id>/config (fleet:generate also does this)
  const runtimeDir = path.join(ctx.host.fleetRepoRoot, "config", "runtime");
  const destDir = path.join(
    ctx.host.deployRoot,
    "tenants",
    tenantId,
    "config",
  );
  fs.mkdirSync(destDir, { recursive: true });
  for (const file of ["site.json", "theme.json", "entitlements.json", "tax.json"]) {
    const src = path.join(runtimeDir, file);
    if (!fs.existsSync(src)) {
      throw new Error(`missing materialized ${file}`);
    }
    fs.copyFileSync(src, path.join(destDir, file));
  }
  await ctx.log(`copied runtime config → ${destDir}`);

  const genArgs = ["run", "fleet:generate", "--", "--tenant", tenantId];
  await ctx.log(formatCmd("npm", genArgs, redactor));
  const gen = await runShell({
    cmd: "npm",
    args: genArgs,
    cwd: ctx.host.fleetRepoRoot,
    redactor,
    timeoutMs: 180_000,
  });
  await logShell(ctx, redactor, "fleet:generate", gen);
  if (gen.code !== 0) {
    throw new Error("fleet:generate failed");
  }

  // fleet:generate may overwrite .env with empty secrets — re-merge from our assembled file.
  // writeTenantEnvAssembled already ran; regenerate preserves non-empty via fleet code,
  // but re-apply our internal secrets to be safe.
  await ctx.log(
    "fleet:generate complete — .env secret keys preserved when non-empty",
  );
}

async function ensureFleetImage(
  ctx: ProvisionRoutineContext,
  redactor: SecretRedactor,
): Promise<void> {
  const image =
    process.env.FLEET_IMAGE?.trim() ||
    process.env.CRAFTIES_IMAGE?.trim() ||
    "mercata-storefront:latest";

  const inspect = await runShell({
    cmd: "docker",
    args: ["image", "inspect", image],
    cwd: ctx.host.fleetRepoRoot,
    redactor,
    timeoutMs: 30_000,
  });
  if (inspect.code === 0) {
    await ctx.log(`image present: ${image}`);
    return;
  }

  await ctx.log(`image missing — building ${image}`);
  const build = await runShell({
    cmd: "docker",
    args: [
      "build",
      "-t",
      image,
      "-t",
      "crafties-nextjs:latest",
      ".",
    ],
    cwd: ctx.host.fleetRepoRoot,
    redactor,
    timeoutMs: 1_800_000,
  });
  await logShell(ctx, redactor, "docker build", build);
  if (build.code !== 0) {
    throw new Error("docker build failed");
  }
}

async function stepComposeUp(
  ctx: ProvisionRoutineContext,
  redactor: SecretRedactor,
): Promise<void> {
  await ensureFleetImage(ctx, redactor);

  const compose = ctx.host.composeFile;
  const service = ctx.job.tenant_id;
  const args = [
    "compose",
    "-f",
    compose,
    "up",
    "-d",
    "--force-recreate",
    service,
  ];
  await ctx.log(formatCmd("docker", args, redactor));
  const up = await runShell({
    cmd: "docker",
    args,
    cwd: ctx.host.composeCwd,
    redactor,
    timeoutMs: 180_000,
    env: {
      FLEET_IMAGE:
        process.env.FLEET_IMAGE ||
        process.env.CRAFTIES_IMAGE ||
        "mercata-storefront:latest",
    },
  });
  await logShell(ctx, redactor, "docker compose up", up);
  if (up.code !== 0) {
    throw new Error("docker compose up failed");
  }

  const cname = containerName(ctx.job.tenant_id);
  const linkArgs = [
    "exec",
    cname,
    "sh",
    "-c",
    "mkdir -p /app/public/assets && ln -sfn ../tenants /app/public/assets/tenants",
  ];
  await ctx.log(formatCmd("docker", linkArgs, redactor));
  const link = await runShell({
    cmd: "docker",
    args: linkArgs,
    cwd: ctx.host.fleetRepoRoot,
    redactor,
    timeoutMs: 30_000,
  });
  await logShell(ctx, redactor, "assets symlink", link);
  if (link.code !== 0) {
    throw new Error("assets symlink failed");
  }
}

async function stepHealthCheck(
  ctx: ProvisionRoutineContext,
  redactor: SecretRedactor,
  fleetSecret: string,
): Promise<void> {
  const domain = ctx.job.domain;
  const origin = publicOrigin(domain);
  const timeoutMs = Number(
    process.env.PROVISION_HEALTH_TIMEOUT_MS ?? 180_000,
  );
  const pollMs = 3_000;
  const deadline = Date.now() + timeoutMs;

  await ctx.log(
    `health: polling ${origin}/api/health and /api/_fleet/health (timeout ${timeoutMs}ms)`,
  );

  let lastErr = "timeout";
  while (Date.now() < deadline) {
    try {
      const healthRes = await fetch(`${origin}/api/health`, {
        signal: AbortSignal.timeout(10_000),
        headers: { "user-agent": "MercataProvisionWorker/1" },
      });
      const healthJson = (await healthRes.json()) as {
        ok?: boolean;
        tenant_id?: string;
        db?: { reachable?: boolean };
      };
      const tenantOk =
        healthRes.ok &&
        healthJson.ok === true &&
        String(healthJson.tenant_id ?? "") === ctx.job.tenant_id &&
        healthJson.db?.reachable !== false;

      if (!tenantOk) {
        lastErr = `health not ready: http=${healthRes.status} tenant=${healthJson.tenant_id} ok=${healthJson.ok}`;
        await ctx.log(lastErr);
      } else {
        const fleetRes = await fetch(`${origin}/api/_fleet/health`, {
          signal: AbortSignal.timeout(10_000),
          headers: {
            authorization: `Bearer ${fleetSecret}`,
            "user-agent": "MercataProvisionWorker/1",
          },
        });
        const fleetText = await fleetRes.text();
        const fleetSafe = redactor.redact(fleetText);
        if (!fleetRes.ok) {
          lastErr = `fleet health http=${fleetRes.status} body=${fleetSafe.slice(0, 200)}`;
          await ctx.log(lastErr);
        } else {
          await ctx.log(
            `health ok: /api/health tenant_id=${ctx.job.tenant_id}; /api/_fleet/health http=${fleetRes.status}`,
          );
          return;
        }
      }
    } catch (err) {
      lastErr = err instanceof Error ? err.message : String(err);
      await ctx.log(`health probe error: ${redactor.redact(lastErr)}`);
    }
    await new Promise((r) => setTimeout(r, pollMs));
  }

  throw new Error(`health check failed: ${redactor.redact(lastErr)}`);
}

/**
 * Full host-side provision routine (manual runbook steps 2–6 automated).
 * Secrets never written to logText — only key names and redacted command output.
 */
export async function runProvisionRoutine(
  ctx: ProvisionRoutineContext,
): Promise<{
  outcome: ProvisionOutcome;
  failedStep?: string;
  orphanNotes?: string;
}> {
  const redactor = new SecretRedactor();
  let containerStarted = false;
  let currentStep = "1: validate";
  const orphanBits: string[] = [];

  const mark = (step: string) => {
    currentStep = step;
  };

  try {
    mark("1: validate");
    await ctx.log("── step 1: validate ──");
    await stepValidate(ctx);

    mark("2: generate internal secrets");
    await ctx.log("── step 2: generate internal secrets ──");
    const internal = await stepGenerateInternalSecrets(ctx, redactor);

    mark("3: provision DB");
    await ctx.log("── step 3: load external secrets + provision DB ──");
    const external = await loadExternalSecrets({
      jobId: ctx.job.id,
      tenantId: ctx.job.tenant_id,
      redactor,
    });
    const externalKeys = Object.keys(external).filter((k) =>
      Boolean(external[k]?.trim()),
    );
    await ctx.log(
      `external secrets keys present: ${redactor.describeKeys(externalKeys)}`,
    );
    const adminPassword = resolveAdminPassword(external, redactor);
    if (!external.ADMIN_PASSWORD?.trim()) {
      await ctx.log(
        "ADMIN_PASSWORD not in hand-off — generated (value not logged)",
      );
    } else {
      await ctx.log("ADMIN_PASSWORD loaded from hand-off (value not logged)");
    }

    await stepTenantProvision(ctx, redactor, adminPassword);
    orphanBits.push(
      `DB ${ctx.job.db_name} may exist — inspect before drop/re-run`,
    );

    mark("4: assemble .env");
    await ctx.log("── step 4: assemble tenant .env ──");
    await stepAssembleEnv(ctx, redactor, internal, external);

    mark("5: materialize fleet");
    await ctx.log("── step 5: materialize fleet files ──");
    await stepMaterializeFleet(ctx, redactor);
    await stepAssembleEnv(ctx, redactor, internal, external);

    mark("6: compose up");
    await ctx.log("── step 6: compose up + assets symlink ──");
    await stepComposeUp(ctx, redactor);
    containerStarted = true;

    mark("7: health check");
    await ctx.log("── step 7: health check ──");
    await stepHealthCheck(ctx, redactor, internal.FLEET_SECRET);

    mark("8: success");
    await ctx.log("── step 8: success ──");

    try {
      const { assignTenantToServer } = await import(
        "@/lib/provisioning/assign-tenant"
      );
      const placed = await assignTenantToServer({
        tenantSlug: ctx.job.tenant_id,
        displayName: ctx.job.non_sensitive_config?.displayName,
        domain: ctx.job.domain,
        dbName: ctx.job.db_name,
        serverId: ctx.host.serverId,
        serverName: ctx.host.serverName,
        fleetSecretPlain: internal.FLEET_SECRET,
        planCode: ctx.job.non_sensitive_config?.planCode,
      });
      await ctx.log(
        `CRM placement: tenant #${placed.tenantId} → server ${ctx.host.serverName} (#${ctx.host.serverId})` +
          (placed.created ? " (created)" : " (updated)") +
          (ctx.job.non_sensitive_config?.planCode
            ? ` plan=${ctx.job.non_sensitive_config.planCode}`
            : ""),
      );
      await ctx.log(
        `DNS guidance: point A/AAAA for ${ctx.job.domain} → ${ctx.host.publicIp}`,
      );
    } catch (placeErr) {
      const pmsg =
        placeErr instanceof Error ? placeErr.message : String(placeErr);
      await ctx.log(
        `WARN: CRM server assignment failed: ${redactor.redact(pmsg)} — set tenants.server_id manually`,
      );
    }

    // Purge one-time secret hand-off only after success (retry needs it on failure).
    try {
      const { purgeEncryptedJobSecrets } = await import(
        "@/lib/provisioning/handoff"
      );
      const { purgeExternalSecretFiles } = await import(
        "@/lib/provisioning/secrets"
      );
      await purgeEncryptedJobSecrets(ctx.job.id);
      purgeExternalSecretFiles({
        jobId: ctx.job.id,
        tenantId: ctx.job.tenant_id,
      });
      await ctx.log("secret hand-off purged (ciphertext + host JSON files)");
    } catch (purgeErr) {
      const pmsg =
        purgeErr instanceof Error ? purgeErr.message : String(purgeErr);
      await ctx.log(
        `WARN: secret hand-off purge failed: ${redactor.redact(pmsg)} — delete manually`,
      );
    }
    await ctx.log(
      "succeeded — MANUAL NEXT: (7) brand in Store Management, (8) Excel via tenant:onboard — not auto-run.",
    );
    return { outcome: "succeeded" };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await ctx.log(`FAILED at step [${currentStep}]: ${redactor.redact(msg)}`);

    if (containerStarted) {
      try {
        await cleanupTenantContainer(ctx, redactor);
        orphanBits.push(
          `container tenant-${ctx.job.tenant_id} stop/rm attempted`,
        );
      } catch (cleanupErr) {
        const cmsg =
          cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr);
        await ctx.log(
          `cleanup error: ${redactor.redact(cmsg)} — MANUAL ATTENTION: container may still be running`,
        );
        orphanBits.push(
          `ORPHAN CONTAINER tenant-${ctx.job.tenant_id} — manual docker compose rm required`,
        );
      }
    } else {
      await ctx.log(
        "no container started (or start failed before up) — no compose cleanup needed",
      );
    }

    if (orphanBits.length > 0) {
      await ctx.log(`orphan surface: ${orphanBits.join("; ")}`);
    }

    return {
      outcome: "failed",
      failedStep: currentStep,
      orphanNotes: orphanBits.join("; ") || undefined,
    };
  }
}
