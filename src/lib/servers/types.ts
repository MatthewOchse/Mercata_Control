/**
 * Server — host box registry (capacity + provision metadata).
 *
 * `name` still matches tenant_infra.host (legacy free-text link).
 * Tenants also carry `server_id` FK → servers.id (required; migration 023).
 * Provisioning jobs carry `target_server_id`; each host worker sets
 * MERCATA_SERVER_ID and only claims matching jobs.
 */
export type Server = {
  id: number;
  name: string;
  /** Optional human label (legacy column from 019). */
  label: string | null;
  publicIp: string | null;
  dbHost: string | null;
  dbPort: number | null;
  deployPath: string | null;
  capacity: number;
  active: boolean;
  notes: string | null;
  createdAt?: string;
  updatedAt?: string;
};

/** Canonical seed for the primary box (migration 022). */
export const CAESAR_SERVER_SEED = {
  name: "caesar",
  label: "Primary application host",
  publicIp: "165.49.25.59",
  dbHost: "127.0.0.1",
  dbPort: 3306,
  /** Storefront repo root (package.json / tenant:provision). */
  deployPath: "/home/matthew/caesar/sites/web",
  capacity: 14,
  active: true,
  notes:
    "Caesar — primary box. Live compose/Caddy/tenants: FLEET_DEPLOY_DIR=/home/matthew/caesar/fleet.",
} as const satisfies Omit<Server, "id" | "createdAt" | "updatedAt">;
