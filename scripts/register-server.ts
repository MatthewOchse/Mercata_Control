#!/usr/bin/env tsx
/**
 * Register or refresh a Server row for multi-host provisioning.
 *
 *   npm run register:server -- --name brutus --public-ip x.x.x.x \
 *     --db-host 127.0.0.1 --db-port 3306 \
 *     --deploy-path /home/matthew/brutus/sites/web --capacity 14
 *
 *   npm run register:server -- --name brutus --print-id
 */
import "dotenv/config";
import type { RowDataPacket } from "mysql2/promise";
import { getPool } from "@/lib/db/pool";

type Args = {
  name: string;
  label: string | null;
  publicIp: string | null;
  dbHost: string | null;
  dbPort: number | null;
  deployPath: string | null;
  capacity: number;
  active: boolean;
  notes: string | null;
  printIdOnly: boolean;
};

function usage(): never {
  console.error(`Usage:
  register-server.ts --name <slug> [options]

Options:
  --label <text>
  --public-ip <ip>
  --db-host <host>          default 127.0.0.1 for Caesar-style host MySQL
  --db-port <port>          default 3306
  --deploy-path <abs path>  storefront repo root (package.json)
  --capacity <n>            default 14
  --active 0|1              default 1
  --notes <text>
  --print-id                print id only (after upsert if other flags set)

Requires DATABASE_URL.`);
  process.exit(1);
}

function parseArgs(argv: string[]): Args {
  const out: Args = {
    name: "",
    label: null,
    publicIp: null,
    dbHost: "127.0.0.1",
    dbPort: 3306,
    deployPath: null,
    capacity: 14,
    active: true,
    notes: null,
    printIdOnly: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v == null) usage();
      return v;
    };
    if (a === "--name") out.name = next().trim().toLowerCase();
    else if (a === "--label") out.label = next();
    else if (a === "--public-ip") out.publicIp = next();
    else if (a === "--db-host") out.dbHost = next();
    else if (a === "--db-port") out.dbPort = Number(next());
    else if (a === "--deploy-path") out.deployPath = next();
    else if (a === "--capacity") out.capacity = Number(next());
    else if (a === "--active") out.active = next() !== "0";
    else if (a === "--notes") out.notes = next();
    else if (a === "--print-id") out.printIdOnly = true;
    else usage();
  }

  if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(out.name)) {
    console.error("Invalid --name (use lowercase slug, e.g. brutus)");
    process.exit(1);
  }
  if (!Number.isInteger(out.capacity) || out.capacity < 1) {
    console.error("--capacity must be an integer >= 1");
    process.exit(1);
  }
  if (out.dbPort != null && (!Number.isInteger(out.dbPort) || out.dbPort <= 0)) {
    console.error("--db-port must be a positive integer");
    process.exit(1);
  }

  return out;
}

function wantsUpsert(argv: string[]): boolean {
  // --print-id alone must not overwrite capacity/active with defaults
  const flags = new Set(
    argv.filter((a) => a.startsWith("--") && a !== "--print-id" && a !== "--name"),
  );
  return flags.size > 0;
}

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL?.trim()) {
    throw new Error("DATABASE_URL is required");
  }
  const argv = process.argv.slice(2);
  const args = parseArgs(argv);
  const pool = getPool();

  if (wantsUpsert(argv)) {
    await pool.execute(
      `INSERT INTO servers
         (name, label, public_ip, db_host, db_port, deploy_path, capacity, active, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         label = COALESCE(VALUES(label), label),
         public_ip = COALESCE(VALUES(public_ip), public_ip),
         db_host = COALESCE(VALUES(db_host), db_host),
         db_port = COALESCE(VALUES(db_port), db_port),
         deploy_path = COALESCE(VALUES(deploy_path), deploy_path),
         capacity = VALUES(capacity),
         active = VALUES(active),
         notes = COALESCE(VALUES(notes), notes)`,
      [
        args.name,
        args.label,
        args.publicIp,
        args.dbHost,
        args.dbPort,
        args.deployPath,
        args.capacity,
        args.active ? 1 : 0,
        args.notes,
      ],
    );
  }

  const [rows] = await pool.execute<(RowDataPacket & { id: number })[]>(
    `SELECT id, name, label, public_ip, db_host, db_port, deploy_path, capacity, active
     FROM servers WHERE name = ? LIMIT 1`,
    [args.name],
  );
  const row = rows[0];
  if (!row) {
    throw new Error(
      args.printIdOnly
        ? `Server "${args.name}" not found — register with full flags first`
        : "Server row missing after upsert",
    );
  }

  if (args.printIdOnly) {
    console.log(String(row.id));
  } else {
    console.log(
      JSON.stringify(
        {
          id: Number(row.id),
          name: row.name,
          label: row.label,
          publicIp: row.public_ip,
          dbHost: row.db_host,
          dbPort: row.db_port == null ? null : Number(row.db_port),
          deployPath: row.deploy_path,
          capacity: Number(row.capacity),
          active: Boolean(row.active),
          mercataServerIdEnv: `MERCATA_SERVER_ID=${row.id}`,
        },
        null,
        2,
      ),
    );
  }

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
