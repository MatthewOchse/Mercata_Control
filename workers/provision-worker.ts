/**
 * Host-scoped provisioning worker.
 *
 * - Requires MERCATA_SERVER_ID (= servers.id for this box)
 * - Only claims / reclaims jobs where target_server_id = that id
 * - Resolves deploy/DB/publicIp from the Server row
 * - One worker process per server
 *
 * Run (dev):
 *   DATABASE_URL=… MERCATA_SERVER_ID=1 npx tsx workers/provision-worker.ts
 *
 * Production: deploy/systemd/mercata-provision-worker.service
 * New box:    deploy/systemd/ADD_SERVER_WORKER.md
 */
import "dotenv/config";
import {
  appendProvisioningJobLog,
  claimNextQueuedJob,
  finishProvisioningJob,
  reclaimStaleRunningJobs,
} from "@/lib/provisioning/jobs";
import { runProvisionSteps } from "@/lib/provisioning/execute";
import { resolveProvisionHost } from "@/lib/provisioning/host";
import { auditProvision } from "@/lib/provisioning/audit";
import { getServerById } from "@/lib/servers/queries";
import { getPool } from "@/lib/db/pool";

const POLL_MS = Number(process.env.PROVISION_WORKER_POLL_MS ?? 5_000);
const STALE_MINUTES = Number(process.env.PROVISION_WORKER_STALE_MINUTES ?? 30);

function readMercataServerId(): number {
  const raw = process.env.MERCATA_SERVER_ID?.trim();
  if (!raw) {
    throw new Error(
      "MERCATA_SERVER_ID is required (servers.id for this host — see ADD_SERVER_WORKER.md)",
    );
  }
  const id = Number(raw);
  if (!Number.isFinite(id) || id <= 0 || !Number.isInteger(id)) {
    throw new Error(`MERCATA_SERVER_ID must be a positive integer (got ${raw})`);
  }
  return id;
}

const MERCATA_SERVER_ID = readMercataServerId();

let stopping = false;
let busy = false;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function processOneJob(): Promise<boolean> {
  const job = await claimNextQueuedJob(MERCATA_SERVER_ID);
  if (!job) return false;

  const log = async (line: string) => {
    const safe = line
      .replace(
        /^([A-Za-z0-9_]*(?:SECRET|PASSWORD|PASSPHRASE|API_KEY|TOKEN)[A-Za-z0-9_]*)\s*=\s*.+$/gim,
        "$1=***",
      )
      .replace(/(--admin-pass|--password)\s+\S+/gi, "$1 ***")
      .replace(/(\s-p)\S+/g, "$1***")
      .replace(/(Authorization:\s*Bearer\s+)\S+/gi, "$1***");
    const stamped = `[${new Date().toISOString()}] ${safe}`;
    console.log(`[job ${job.id}] ${safe}`);
    await appendProvisioningJobLog(job.id, stamped);
  };

  // Defence in depth: never run a job meant for another box.
  if (job.target_server_id !== MERCATA_SERVER_ID) {
    await log(
      `FATAL: claimed job target_server_id=${job.target_server_id} ` +
        `≠ MERCATA_SERVER_ID=${MERCATA_SERVER_ID} — refusing`,
    );
    await finishProvisioningJob(
      job.id,
      "failed",
      "server scope mismatch",
      { failedStep: "bootstrap", orphanNotes: null },
    );
    return true;
  }

  await log(
    `claimed job for tenant=${job.tenant_id} tier=${job.tier} ` +
      `target_server_id=${job.target_server_id}`,
  );

  try {
    const server = await getServerById(job.target_server_id);
    if (!server) {
      throw new Error(`Server #${job.target_server_id} not found`);
    }
    if (!server.active) {
      throw new Error(`Server "${server.name}" (#${server.id}) is not active`);
    }
    const host = resolveProvisionHost(server);
    await log(
      `resolved host ${host.serverName}: deploy=${host.fleetRepoRoot} ` +
        `db=${host.provisionDbHost}:${host.provisionDbPort} ip=${host.publicIp}`,
    );

    const result = await runProvisionSteps({
      job,
      host,
      log,
    });
    await finishProvisioningJob(
      job.id,
      result.outcome,
      `finished → ${result.outcome}`,
      {
        failedStep: result.failedStep ?? null,
        orphanNotes: result.orphanNotes ?? null,
      },
    );
    await auditProvision({
      actor: "provision-worker",
      action: "provision.outcome",
      jobId: job.id,
      tenantId: job.tenant_id,
      after: {
        outcome: result.outcome,
        failedStep: result.failedStep ?? null,
        orphanNotes: result.orphanNotes ?? null,
        targetServerId: host.serverId,
        serverName: host.serverName,
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await log(`FATAL: ${msg}`);
    await finishProvisioningJob(job.id, "failed", msg, {
      failedStep: "fatal",
      orphanNotes: "see log — MANUAL ATTENTION",
    });
    await auditProvision({
      actor: "provision-worker",
      action: "provision.outcome",
      jobId: job.id,
      tenantId: job.tenant_id,
      after: {
        outcome: "failed",
        failedStep: "fatal",
        targetServerId: job.target_server_id,
      },
    });
  }

  return true;
}

async function tick(): Promise<void> {
  if (stopping || busy) return;
  busy = true;
  try {
    const reclaimed = await reclaimStaleRunningJobs(
      STALE_MINUTES,
      MERCATA_SERVER_ID,
    );
    if (reclaimed > 0) {
      console.log(
        `[worker] reclaimed ${reclaimed} stale running job(s) for server #${MERCATA_SERVER_ID}`,
      );
    }
    await processOneJob();
  } catch (err) {
    console.error("[worker] tick error:", err);
  } finally {
    busy = false;
  }
}

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL?.trim()) {
    throw new Error("DATABASE_URL is required");
  }

  await getPool().query("SELECT 1");

  const server = await getServerById(MERCATA_SERVER_ID);
  if (!server) {
    throw new Error(
      `MERCATA_SERVER_ID=${MERCATA_SERVER_ID} does not match a servers row`,
    );
  }
  if (!server.active) {
    throw new Error(
      `MERCATA_SERVER_ID=${MERCATA_SERVER_ID} (${server.name}) is not active`,
    );
  }

  console.log(
    `[worker] started server=${server.name} (#${server.id}) ` +
      `poll=${POLL_MS}ms stale=${STALE_MINUTES}m ` +
      `(only target_server_id=${server.id})`,
  );

  const onStop = (sig: string) => {
    console.log(`[worker] ${sig} — finishing current job then exit`);
    stopping = true;
  };
  process.on("SIGINT", () => onStop("SIGINT"));
  process.on("SIGTERM", () => onStop("SIGTERM"));

  while (!stopping) {
    await tick();
    if (stopping) break;
    await sleep(POLL_MS);
  }

  await getPool().end();
  console.log("[worker] stopped");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
