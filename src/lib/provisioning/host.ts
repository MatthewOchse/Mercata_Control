/**
 * Resolve host-specific provision paths/params from a Server row.
 *
 * Replaces hardcoded Caesar defaults / FLEET_REPO_ROOT env for:
 *   deploy path, compose cwd, Caddyfile location, provision DB host/port,
 *   public IP (DNS guidance), host-side assets directory.
 *
 * Container MYSQL_HOST remains host.docker.internal (Docker networking —
 * not the same as Server.dbHost, which the worker uses on the host).
 */
import path from "node:path";
import type { Server } from "@/lib/servers/types";
import { CAESAR_SERVER_SEED } from "@/lib/servers/types";

export type ProvisionHostTarget = {
  serverId: number;
  serverName: string;
  /** Fleet repo root (= Server.deployPath). Was FLEET_REPO_ROOT. */
  fleetRepoRoot: string;
  /** {fleetRepoRoot}/deploy — was FLEET_DEPLOY_DIR or join(repo, "deploy"). */
  deployRoot: string;
  /** docker-compose.fleet.yml absolute path. */
  composeFile: string;
  /** Working directory for docker compose (dirname of composeFile). */
  composeCwd: string;
  /** Caddyfile written by fleet:generate. */
  caddyFile: string;
  /** Host-side tenant assets dir mounted/linked into containers. */
  assetsHostPath: string;
  /** MySQL host for provision worker probes/seeds. Was 127.0.0.1. */
  provisionDbHost: string;
  /** MySQL port (resolved; CLI still omits -P when 3306 for byte-identical cmds). */
  provisionDbPort: number;
  /** Public IP for DNS A-record guidance. */
  publicIp: string;
  /**
   * MYSQL_HOST inside the tenant container.
   * Docker-on-host convention — not Server.dbHost.
   */
  containerMysqlHost: string;
};

/** Values the routine used for Caesar before Server lookup (Prompt 0). */
export const CAESAR_LEGACY_HARDCODED = {
  fleetRepoRoot: CAESAR_SERVER_SEED.deployPath,
  deployRoot: path.join(CAESAR_SERVER_SEED.deployPath, "deploy"),
  composeFile: path.join(
    CAESAR_SERVER_SEED.deployPath,
    "deploy",
    "docker-compose.fleet.yml",
  ),
  composeCwd: path.join(CAESAR_SERVER_SEED.deployPath, "deploy"),
  caddyFile: path.join(CAESAR_SERVER_SEED.deployPath, "deploy", "Caddyfile"),
  assetsHostPath: path.join(CAESAR_SERVER_SEED.deployPath, "deploy", "tenants"),
  provisionDbHost: "127.0.0.1",
  provisionDbPort: 3306,
  publicIp: CAESAR_SERVER_SEED.publicIp,
  containerMysqlHost: "host.docker.internal",
} as const;

export function resolveProvisionHost(server: Server): ProvisionHostTarget {
  const deployPath = server.deployPath?.trim();
  if (!deployPath) {
    throw new Error(
      `Server "${server.name}" (#${server.id}) has no deploy_path`,
    );
  }
  const dbHost = server.dbHost?.trim();
  if (!dbHost) {
    throw new Error(`Server "${server.name}" (#${server.id}) has no db_host`);
  }
  const dbPort = server.dbPort;
  if (dbPort == null || !Number.isFinite(dbPort) || dbPort <= 0) {
    throw new Error(`Server "${server.name}" (#${server.id}) has no db_port`);
  }
  const publicIp = server.publicIp?.trim();
  if (!publicIp) {
    throw new Error(`Server "${server.name}" (#${server.id}) has no public_ip`);
  }

  const deployRoot = path.join(deployPath, "deploy");
  const composeFile = path.join(deployRoot, "docker-compose.fleet.yml");

  return {
    serverId: server.id,
    serverName: server.name,
    fleetRepoRoot: deployPath,
    deployRoot,
    composeFile,
    composeCwd: path.dirname(composeFile),
    caddyFile: path.join(deployRoot, "Caddyfile"),
    assetsHostPath: path.join(deployRoot, "tenants"),
    provisionDbHost: dbHost,
    provisionDbPort: dbPort,
    publicIp,
    containerMysqlHost: "host.docker.internal",
  };
}
