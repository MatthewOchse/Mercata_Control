import { getPool } from "@/lib/db/pool";
import { writeAuditLog } from "@/lib/db/audit";

/** Provisioning audit actions — never include secret values in before/after. */
export type ProvisionAuditAction =
  | "provision.enqueue"
  | "provision.retry"
  | "provision.view"
  | "provision.outcome";

/** Scrub secret-looking keys from audit payloads (exported for tests). */
export function scrubProvisionAuditPayload(
  tenantId: string,
  obj?: Record<string, unknown>,
): Record<string, unknown> | null {
  if (!obj) return null;
  const out: Record<string, unknown> = { tenantId };
  for (const [k, v] of Object.entries(obj)) {
    if (/password|secret|passphrase|token|api_key|ciphertext/i.test(k)) {
      // Allow boolean/number flags like hasAdminPassword — never string values.
      if (typeof v === "boolean" || typeof v === "number") {
        out[k] = v;
        continue;
      }
      out[k] = "[redacted]";
      continue;
    }
    if (typeof v === "string" && v.length >= 16 && /[A-Za-z0-9+/=_-]{16,}/.test(v)) {
      // Heuristic: long opaque tokens that slipped into a non-secret key name.
      if (/bearer|sk_live|sk_test|eyJ/i.test(v)) {
        out[k] = "[redacted]";
        continue;
      }
    }
    out[k] = v;
  }
  return out;
}

export async function auditProvision(opts: {
  actor: string;
  action: ProvisionAuditAction;
  jobId: number | string;
  tenantId: string;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
}): Promise<void> {
  await writeAuditLog(getPool(), {
    actor: opts.actor,
    action: opts.action,
    entityType: "provisioning_job",
    entityId: opts.jobId,
    before: scrubProvisionAuditPayload(opts.tenantId, opts.before) ?? undefined,
    after: scrubProvisionAuditPayload(opts.tenantId, opts.after) ?? undefined,
  });
}
