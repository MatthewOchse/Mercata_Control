"use server";

import { redirect } from "next/navigation";
import { requireSuperAdmin } from "@/lib/auth/server";
import { enqueueProvisioningJob } from "@/lib/provisioning/jobs";
import { requeueFailedProvisioningJob } from "@/lib/provisioning/jobs";
import {
  storeEncryptedJobSecrets,
  type ExternalSecretPayload,
} from "@/lib/provisioning/handoff";
import { assertProvisionCollisions } from "@/lib/provisioning/collisions";
import { auditProvision } from "@/lib/provisioning/audit";
import { listServerFillOptions } from "@/lib/servers/queries";
import { resolveTargetServerSelection } from "@/lib/servers/assign";
import { getPlan } from "@/lib/plans/queries";
import { platformTierForPlan } from "@/lib/plans/tier-map";
import type { ProvisioningTier } from "@/lib/provisioning/types";

export type ProvisionActionState = {
  error?: string;
  message?: string;
};

function formStr(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

function optionalSecret(formData: FormData, key: string): string | undefined {
  const v = formStr(formData, key);
  return v ? v : undefined;
}

/**
 * Create a queued ProvisioningJob + encrypted one-time secret hand-off.
 * Never returns secrets to the client — redirects to the status page.
 */
export async function enqueueProvisionJobAction(
  _prev: ProvisionActionState,
  formData: FormData,
): Promise<ProvisionActionState> {
  let operator;
  try {
    operator = await requireSuperAdmin();
  } catch {
    return { error: "Forbidden: super-admin only" };
  }

  try {
    const tenantId = formStr(formData, "tenant_id").toLowerCase();
    const displayName = formStr(formData, "display_name");
    const domain = formStr(formData, "domain")
      .toLowerCase()
      .replace(/^https?:\/\//, "")
      .replace(/\/$/, "");
    const planCode = formStr(formData, "plan_code");
    const tierRaw = formStr(formData, "tier");
    const dbName = formStr(formData, "db_name");
    const adminEmail =
      formStr(formData, "admin_email") || `admin@${domain}`;
    const adminPassword = formStr(formData, "admin_password");

    if (!displayName) throw new Error("Display name is required");
    if (!planCode) throw new Error("Billing plan is required");
    const plan = await getPlan(planCode);
    if (!plan || !plan.active) {
      throw new Error(`Unknown or inactive plan "${planCode}"`);
    }

    const tier = (
      tierRaw === "online" || tierRaw === "retail"
        ? tierRaw
        : platformTierForPlan(planCode)
    ) as ProvisioningTier;
    if (tier !== "online" && tier !== "retail") {
      throw new Error("Platform tier must be online or retail");
    }
    if (!/^[A-Za-z0-9_]{1,64}$/.test(dbName)) {
      throw new Error("DB name must be 1–64 characters [A-Za-z0-9_]");
    }
    if (!adminEmail.includes("@")) {
      throw new Error("Admin email is invalid");
    }
    if (adminPassword.length < 12) {
      throw new Error("Admin password must be at least 12 characters");
    }

    await assertProvisionCollisions({ tenantId, domain });

    const fillOptions = await listServerFillOptions();
    const resolved = resolveTargetServerSelection({
      selection: formStr(formData, "target_server") || "auto",
      servers: fillOptions,
      forceOverCapacity: formData.get("force_over_capacity") === "on",
    });
    if (!resolved.ok) {
      throw new Error(resolved.error);
    }
    const server = resolved.server;
    if (!server.publicIp?.trim()) {
      throw new Error(
        `Server "${server.name}" has no public_ip — set it under /servers for DNS guidance`,
      );
    }

    const mysqlPort = optionalSecret(formData, "mysql_port") || "3306";

    const payload: ExternalSecretPayload = {
      ADMIN_PASSWORD: adminPassword,
      ADMIN_EMAIL: adminEmail,
      MYSQL_HOST: optionalSecret(formData, "mysql_host"),
      MYSQL_PORT: mysqlPort,
      MYSQL_USER: optionalSecret(formData, "mysql_user"),
      MYSQL_PASSWORD: optionalSecret(formData, "mysql_password"),
      PAYFAST_MERCHANT_ID: optionalSecret(formData, "payfast_merchant_id"),
      PAYFAST_MERCHANT_KEY: optionalSecret(formData, "payfast_merchant_key"),
      PAYFAST_PASSPHRASE: optionalSecret(formData, "payfast_passphrase"),
      PAYFAST_SANDBOX:
        formData.get("payfast_sandbox") === "on" ? "1" : undefined,
      SHIPLOGIC_BASE_URL: optionalSecret(formData, "shiplogic_base_url"),
      SHIPLOGIC_API_KEY: optionalSecret(formData, "shiplogic_api_key"),
      SHIPLOGIC_COLLECTION_JSON: optionalSecret(
        formData,
        "shiplogic_collection_json",
      ),
      SHIPLOGIC_SANDBOX:
        formData.get("shiplogic_sandbox") === "on" ? "1" : undefined,
      TCG_LOCKER_API_KEY: optionalSecret(formData, "tcg_locker_api_key"),
      CRAFTIES_PUDO_SHIPPING_AMOUNT: optionalSecret(
        formData,
        "pudo_shipping_amount",
      ),
      SMTP_HOST: optionalSecret(formData, "smtp_host"),
      SMTP_PORT: optionalSecret(formData, "smtp_port"),
      SMTP_USER: optionalSecret(formData, "smtp_user"),
      SMTP_PASS: optionalSecret(formData, "smtp_pass"),
    };

    for (const key of Object.keys(payload)) {
      if (!payload[key]?.trim()) delete payload[key];
    }
    payload.ADMIN_PASSWORD = adminPassword;
    payload.ADMIN_EMAIL = adminEmail;
    // Port is always present — shared host MySQL (default 3306).
    payload.MYSQL_PORT = mysqlPort;

    const jobId = await enqueueProvisioningJob({
      tenantId,
      tier,
      domain,
      dbName,
      targetServerId: server.id,
      createdBy: operator.id,
      config: {
        displayName,
        adminUsername: adminEmail,
        host: server.name,
        planCode: plan.code,
      },
    });

    await storeEncryptedJobSecrets(jobId, payload);

    await auditProvision({
      actor: operator.email,
      action: "provision.enqueue",
      jobId,
      tenantId,
      after: {
        domain,
        tier,
        planCode: plan.code,
        dbName,
        displayName,
        targetServerId: server.id,
        serverName: server.name,
        assignMode: resolved.mode,
        publicIp: server.publicIp,
        mysqlPort,
        secretKeys: Object.keys(payload).filter((k) => k !== "ADMIN_PASSWORD"),
        hasAdminPassword: true,
      },
    });

    redirect(`/tenants/provision/${jobId}`);
  } catch (err) {
    if (
      err &&
      typeof err === "object" &&
      "digest" in err &&
      String((err as { digest?: string }).digest).startsWith("NEXT_REDIRECT")
    ) {
      throw err;
    }
    return {
      error: err instanceof Error ? err.message : "Failed to enqueue job",
    };
  }
}

/** Idempotent retry of a failed job — reuses DB/.env on the host when present. */
export async function retryProvisionJobAction(
  jobId: number,
): Promise<ProvisionActionState> {
  let operator;
  try {
    operator = await requireSuperAdmin();
  } catch {
    return { error: "Forbidden: super-admin only" };
  }

  try {
    const id = Number(jobId);
    if (!Number.isFinite(id) || id <= 0) throw new Error("Invalid job id");

    const { getProvisioningJob } = await import("@/lib/provisioning/jobs");
    const existing = await getProvisioningJob(id);
    if (!existing) throw new Error("Job not found");
    if (existing.status !== "failed") {
      throw new Error(`Only failed jobs can be retried (status=${existing.status})`);
    }

    // Block if another job for same id/domain is already active.
    await assertProvisionCollisions({
      tenantId: existing.tenant_id,
      domain: existing.domain,
      excludeJobId: existing.id,
    });

    const job = await requeueFailedProvisioningJob(id);

    await auditProvision({
      actor: operator.email,
      action: "provision.retry",
      jobId: job.id,
      tenantId: job.tenant_id,
      after: {
        retryCount: job.non_sensitive_config?.retryCount ?? 1,
        status: "queued",
      },
    });

    return { message: `Retry #${job.non_sensitive_config?.retryCount ?? 1} queued` };
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "Retry failed",
    };
  }
}
