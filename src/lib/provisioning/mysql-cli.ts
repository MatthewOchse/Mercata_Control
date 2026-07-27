import { accessSync, constants as fsConstants } from "node:fs";
import { runShell, type ShellResult } from "@/lib/provisioning/shell";
import type { SecretRedactor } from "@/lib/provisioning/redact";

let cachedMysqlBin: string | null | undefined;

function findMysqlBin(): string | null {
  if (cachedMysqlBin !== undefined) return cachedMysqlBin;
  for (const candidate of ["/usr/bin/mysql", "/usr/local/bin/mysql"]) {
    try {
      accessSync(candidate, fsConstants.X_OK);
      cachedMysqlBin = candidate;
      return candidate;
    } catch {
      /* try next */
    }
  }
  cachedMysqlBin = null;
  return null;
}

function isLoopbackHost(host: string): boolean {
  const h = host.trim().toLowerCase();
  return h === "127.0.0.1" || h === "localhost" || h === "::1";
}

/**
 * Default Caesar / host-MySQL container name. Override with
 * PROVISION_MYSQL_CONTAINER when the box uses a different compose name.
 */
export function provisionMysqlContainer(): string {
  return (
    process.env.PROVISION_MYSQL_CONTAINER?.trim() || "crafties-dev-mysql"
  );
}

/**
 * Run a MySQL client statement as the provision user.
 *
 * Prefers a host `mysql` binary. On boxes without mysql-client (ENOENT),
 * falls back to `docker exec` into the host MySQL container when talking to
 * loopback — Caesar’s crafties-dev-mysql pattern.
 */
export async function runMysqlCli(opts: {
  host: string;
  port: number;
  user: string;
  password: string;
  /** Args after connection flags, e.g. ["-N", "-e", "SELECT 1"]. */
  sqlArgs: string[];
  cwd: string;
  redactor: SecretRedactor;
  timeoutMs?: number;
}): Promise<ShellResult> {
  opts.redactor.track(opts.password);
  const bin = findMysqlBin();

  if (bin) {
    const args = [
      `-h${opts.host}`,
      ...(opts.port !== 3306 ? [`-P${opts.port}`] : []),
      `-u${opts.user}`,
      ...(opts.password ? [`-p${opts.password}`] : []),
      ...opts.sqlArgs,
    ];
    return runShell({
      cmd: bin,
      args,
      cwd: opts.cwd,
      redactor: opts.redactor,
      timeoutMs: opts.timeoutMs,
    });
  }

  if (!isLoopbackHost(opts.host)) {
    throw new Error(
      `mysql client not installed on PATH, and host ${opts.host} is not loopback — ` +
        `install mysql-client or set PROVISION_MYSQL_CONTAINER for local Docker MySQL`,
    );
  }

  const container = provisionMysqlContainer();
  const args = [
    "exec",
    "-e",
    `MYSQL_PWD=${opts.password}`,
    container,
    "mysql",
    `-u${opts.user}`,
    ...opts.sqlArgs,
  ];
  return runShell({
    cmd: "docker",
    args,
    cwd: opts.cwd,
    redactor: opts.redactor,
    timeoutMs: opts.timeoutMs,
  });
}
