#!/usr/bin/env tsx
/**
 * Preflight checks before provisioning onto a named Server.
 *
 *   npm run smoke:server -- --name brutus
 *
 * Registry checks run wherever DATABASE_URL points. The deploy_path
 * filesystem check only applies when this process can see that path
 * (run on the target host for a full pass).
 */
import "dotenv/config";
import fs from "node:fs";
import { getPool } from "@/lib/db/pool";
import { getServerByName } from "@/lib/servers/queries";

function usage(): never {
  console.error("Usage: smoke-server.ts --name <server-name>");
  process.exit(1);
}

function parseName(argv: string[]): string {
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--name") {
      const v = argv[++i];
      if (!v) usage();
      return v.trim().toLowerCase();
    }
  }
  usage();
}

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL?.trim()) {
    throw new Error("DATABASE_URL is required");
  }
  const name = parseName(process.argv.slice(2));
  const server = await getServerByName(name);
  if (!server) {
    throw new Error(`Server "${name}" not found — run register:server first`);
  }

  const problems: string[] = [];
  const warnings: string[] = [];
  if (!server.active) problems.push("active=0 (mark active when host is ready)");
  if (!server.publicIp?.trim()) problems.push("public_ip is empty (needed for DNS guidance)");
  if (!server.dbHost?.trim()) problems.push("db_host is empty");
  if (server.dbPort == null) problems.push("db_port is empty");
  if (!server.deployPath?.trim()) {
    problems.push("deploy_path is empty (must be storefront repo root)");
  } else {
    const pkg = `${server.deployPath.replace(/\/$/, "")}/package.json`;
    if (!fs.existsSync(pkg)) {
      warnings.push(
        `deploy_path not visible here (${pkg}) — run smoke:server on the target host to verify`,
      );
    }
  }
  if (server.capacity < 1) problems.push("capacity < 1");

  const report = {
    id: server.id,
    name: server.name,
    publicIp: server.publicIp,
    dbHost: server.dbHost,
    dbPort: server.dbPort,
    deployPath: server.deployPath,
    capacity: server.capacity,
    active: server.active,
    mercataServerIdEnv: `MERCATA_SERVER_ID=${server.id}`,
    ok: problems.length === 0,
    problems,
    warnings,
    next: [
      `Set MERCATA_SERVER_ID=${server.id} on this host's .env.worker`,
      "Queue a throwaway tenant with Target server = this box",
      "Confirm only this worker claims the job",
      "Point smoke DNS A record at publicIp, check /api/health",
      "Offboard smoke tenant (compose rm, DROP DATABASE, CRM offboard)",
    ],
  };

  console.log(JSON.stringify(report, null, 2));
  await getPool().end();
  if (problems.length > 0) process.exit(2);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
