import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  isSecretEnvKey,
  type SecretRedactor,
} from "@/lib/provisioning/redact";

/**
 * Operator-supplied external secrets for a job (Prompt 4 writes these).
 * Never stored in provisioning_jobs — only on the host filesystem.
 *
 * Default path: $PROVISION_SECRETS_DIR/<jobId>.json
 * Fallback:     $PROVISION_SECRETS_DIR/<tenantId>.json
 */
export type ExternalProvisionSecrets = {
  /** Storefront admin password (required unless ADMIN_PASSWORD_FILE). */
  ADMIN_PASSWORD?: string;
  MYSQL_USER?: string;
  MYSQL_PASSWORD?: string;
  MYSQL_HOST?: string;
  MYSQL_PORT?: string;
  PAYFAST_MERCHANT_ID?: string;
  PAYFAST_MERCHANT_KEY?: string;
  PAYFAST_PASSPHRASE?: string;
  SHIPLOGIC_API_KEY?: string;
  TCG_LOCKER_API_KEY?: string;
  SMTP_HOST?: string;
  SMTP_PORT?: string;
  SMTP_USER?: string;
  SMTP_PASS?: string;
  /** Allow extra keys without listing every payment provider. */
  [key: string]: string | undefined;
};

export type InternalSecrets = {
  AUTH_SECRET: string;
  STORE_ADMIN_SECRET: string;
  FLEET_SECRET: string;
};

export function provisionSecretsDir(): string {
  return (
    process.env.PROVISION_SECRETS_DIR?.trim() ||
    "/var/lib/mercata/provision-secrets"
  );
}

/**
 * Prefer encrypted DB hand-off (decrypt; purge on success); fall back to host JSON files.
 */
export async function loadExternalSecrets(opts: {
  jobId: number;
  tenantId: string;
  redactor: SecretRedactor;
}): Promise<ExternalProvisionSecrets> {
  // Dynamic import avoids pulling Next/crypto into tests that only need openssl helpers.
  const { consumeEncryptedJobSecrets } = await import(
    "@/lib/provisioning/handoff"
  );
  const fromHandoff = await consumeEncryptedJobSecrets(opts.jobId, opts.redactor);
  if (fromHandoff) {
    return fromHandoff;
  }

  const dir = provisionSecretsDir();
  const candidates = [
    path.join(dir, `${opts.jobId}.json`),
    path.join(dir, `${opts.tenantId}.json`),
  ];
  for (const file of candidates) {
    if (!fs.existsSync(file)) continue;
    const raw = fs.readFileSync(file, "utf8");
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error(`Invalid JSON in secrets file ${file}`);
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error(`Secrets file ${file} must be a JSON object`);
    }
    const out: ExternalProvisionSecrets = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (v == null) continue;
      out[k] = String(v);
    }
    opts.redactor.trackMany(out);
    // Keep file until purgeExternalSecretFiles on success (retry-safe).
    return out;
  }
  return {};
}

/** Unlink host JSON secret files after a successful provision. */
export function purgeExternalSecretFiles(opts: {
  jobId: number;
  tenantId: string;
}): void {
  const dir = provisionSecretsDir();
  for (const file of [
    path.join(dir, `${opts.jobId}.json`),
    path.join(dir, `${opts.tenantId}.json`),
  ]) {
    try {
      if (fs.existsSync(file)) fs.unlinkSync(file);
    } catch {
      /* best-effort */
    }
  }
}

/** `openssl rand -base64 32` — fails closed if openssl missing. */
export function opensslRandBase64(bytes = 32): string {
  const result = spawnSync(
    "openssl",
    ["rand", "-base64", String(bytes)],
    { encoding: "utf8" },
  );
  if (result.status !== 0) {
    throw new Error(
      `openssl rand failed: ${result.stderr?.trim() || result.error?.message}`,
    );
  }
  const value = result.stdout.trim();
  if (value.length < 16) {
    throw new Error("openssl rand returned empty/short output");
  }
  return value;
}

export function generateInternalSecrets(
  redactor: SecretRedactor,
): InternalSecrets {
  const secrets: InternalSecrets = {
    AUTH_SECRET: opensslRandBase64(32),
    STORE_ADMIN_SECRET: opensslRandBase64(32),
    FLEET_SECRET: opensslRandBase64(32),
  };
  redactor.trackMany(secrets);
  return secrets;
}

/**
 * Read existing tenant .env and return map. Tracks secret values for redaction.
 */
export function readEnvFile(
  envPath: string,
  redactor: SecretRedactor,
): Map<string, string> {
  const map = new Map<string, string>();
  if (!fs.existsSync(envPath)) return map;
  const content = fs.readFileSync(envPath, "utf8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1);
    map.set(key, value);
    if (isSecretEnvKey(key)) redactor.track(value);
  }
  return map;
}

/**
 * Merge env maps and write deploy/tenants/<id>/.env.
 * Returns list of keys written (values never returned to caller logs).
 */
export function writeTenantEnvAssembled(opts: {
  envPath: string;
  values: Record<string, string>;
  redactor: SecretRedactor;
}): string[] {
  opts.redactor.trackMany(opts.values);
  fs.mkdirSync(path.dirname(opts.envPath), { recursive: true });

  const existing = readEnvFile(opts.envPath, opts.redactor);
  const merged = new Map(existing);
  for (const [k, v] of Object.entries(opts.values)) {
    if (v.trim()) merged.set(k, v);
  }

  const lines: string[] = [
    `# Assembled by mercata provision worker — do not commit.`,
    `# ${new Date().toISOString()}`,
    "",
  ];

  const preferredOrder = [
    "TENANT_ID",
    "TENANT_CONFIG_DIR",
    "NODE_ENV",
    "MYSQL_HOST",
    "MYSQL_PORT",
    "MYSQL_DATABASE",
    "MYSQL_USER",
    "MYSQL_PASSWORD",
    "AUTH_URL",
    "NEXTAUTH_URL",
    "NEXT_PUBLIC_APP_URL",
    "AUTH_SECRET",
    "NEXTAUTH_SECRET",
    "STORE_ADMIN_SECRET",
    "CRAFTIES_ADMIN_SECRET",
    "FLEET_SECRET",
  ];

  const written: string[] = [];
  const seen = new Set<string>();

  const emit = (key: string) => {
    if (seen.has(key)) return;
    const value = merged.get(key);
    if (value == null) return;
    seen.add(key);
    written.push(key);
    lines.push(`${key}=${value}`);
  };

  for (const key of preferredOrder) emit(key);
  for (const key of [...merged.keys()].sort()) emit(key);

  lines.push("");
  fs.writeFileSync(opts.envPath, lines.join("\n"), { mode: 0o600 });
  try {
    fs.chmodSync(opts.envPath, 0o600);
  } catch {
    /* best-effort on platforms without chmod */
  }
  return written;
}

export function resolveAdminPassword(
  external: ExternalProvisionSecrets,
  redactor: SecretRedactor,
): string {
  const fromFile = external.ADMIN_PASSWORD?.trim();
  if (fromFile) {
    redactor.track(fromFile);
    return fromFile;
  }
  const generated = opensslRandBase64(24);
  redactor.track(generated);
  return generated;
}
