import type { RowDataPacket } from "mysql2/promise";
import { query } from "@/lib/db/pool";

const RESERVED = new Set(["crafties", "demo-online", "geist"]);

export type CollisionCheckOpts = {
  tenantId: string;
  domain: string;
  /** When retrying an existing job, exclude it from "already running" checks. */
  excludeJobId?: number;
};

/**
 * Block duplicate tenant ids / domains before queuing.
 * Refuses a second job while another is queued/running/awaiting for the same id or domain.
 */
export async function assertProvisionCollisions(
  opts: CollisionCheckOpts,
): Promise<void> {
  const tenantId = opts.tenantId.trim().toLowerCase();
  const domain = opts.domain
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/$/, "");

  if (!/^[a-z][a-z0-9-]{0,31}$/.test(tenantId)) {
    throw new Error(
      "Tenant id must be 1–32 chars: start with a letter, then [a-z0-9-]",
    );
  }
  if (RESERVED.has(tenantId)) {
    throw new Error(`Tenant id "${tenantId}" is reserved`);
  }
  if (!domain || !domain.includes(".")) {
    throw new Error(`Domain "${opts.domain}" is not well-formed`);
  }

  const adminTenant = await query<RowDataPacket[]>(
    `SELECT id FROM tenants WHERE slug = :slug LIMIT 1`,
    { slug: tenantId },
  );
  if (adminTenant.length > 0) {
    throw new Error(`Tenant slug "${tenantId}" already exists in admin`);
  }

  const infraDomain = await query<RowDataPacket[]>(
    `SELECT tenant_id FROM tenant_infra
     WHERE LOWER(primary_domain) = :domain
     LIMIT 1`,
    { domain },
  );
  if (infraDomain.length > 0) {
    throw new Error(
      `Domain "${domain}" is already assigned to tenant #${infraDomain[0]!.tenant_id}`,
    );
  }

  const exclude = opts.excludeJobId ?? 0;
  const idJobs = await query<RowDataPacket[]>(
    `SELECT id, status FROM provisioning_jobs
     WHERE tenant_id = :tenantId
       AND id <> :exclude
       AND status IN ('queued', 'running', 'awaiting_env', 'succeeded')
     ORDER BY id DESC
     LIMIT 3`,
    { tenantId, exclude },
  );
  if (idJobs.length > 0) {
    const j = idJobs[0]!;
    if (j.status === "running" || j.status === "queued") {
      throw new Error(
        `A job for "${tenantId}" is already ${j.status} (#${j.id}) — refuse second`,
      );
    }
    throw new Error(
      `Tenant id "${tenantId}" already has job #${j.id} (${j.status})`,
    );
  }

  const domainJobs = await query<RowDataPacket[]>(
    `SELECT id, tenant_id, status FROM provisioning_jobs
     WHERE LOWER(domain) = :domain
       AND id <> :exclude
       AND status IN ('queued', 'running', 'awaiting_env', 'succeeded')
     ORDER BY id DESC
     LIMIT 3`,
    { domain, exclude },
  );
  if (domainJobs.length > 0) {
    const j = domainJobs[0]!;
    throw new Error(
      `Domain "${domain}" already used by job #${j.id} (tenant ${j.tenant_id}, ${j.status})`,
    );
  }
}
