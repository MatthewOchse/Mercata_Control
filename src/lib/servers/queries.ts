import type { RowDataPacket } from "mysql2/promise";
import { query } from "@/lib/db/pool";
import { CAPACITY_WARN_PCT } from "@/lib/servers/constants";
import type { Server } from "@/lib/servers/types";
import type { ServerFillOption } from "@/lib/servers/assign";

export type ServerTenant = {
  id: number;
  slug: string;
  tradingName: string;
  status: string;
  planName: string | null;
  mrrCents: number;
};

export type ServerCapacity = {
  id: number;
  name: string;
  label: string | null;
  publicIp: string | null;
  capacity: number;
  notes: string | null;
  active: boolean;
  tenantCount: number;
  /** Rounded percentage of the ceiling in use. */
  usedPct: number;
  remaining: number;
  tone: "ok" | "warn" | "error";
  tenants: ServerTenant[];
};

type ServerRow = RowDataPacket & {
  id: number;
  name: string;
  label: string | null;
  public_ip: string | null;
  capacity: number;
  notes: string | null;
  active: number;
};

type TenantRow = RowDataPacket & {
  server_id: number | null;
  host: string | null;
  id: number;
  slug: string;
  trading_name: string;
  status: string;
  plan_name: string | null;
  plan_mrr: number | null;
  addon_mrr: number | null;
};

function tone(usedPct: number): "ok" | "warn" | "error" {
  if (usedPct >= 100) return "error";
  if (usedPct >= CAPACITY_WARN_PCT) return "warn";
  return "ok";
}

/**
 * Servers with the tenants assigned to them.
 *
 * Prefers `tenants.server_id` (required FK). Falls back to `tenant_infra.host`
 * for legacy rows so unregistered hosts still surface.
 */
export async function listServerCapacity(): Promise<ServerCapacity[]> {
  const [servers, tenants] = await Promise.all([
    query<ServerRow[]>(
      `SELECT id, name, label, public_ip, capacity, notes, active
       FROM servers ORDER BY name`,
    ),
    query<TenantRow[]>(
      `SELECT t.server_id, ti.host, t.id, t.slug, t.trading_name, t.status,
              p.name AS plan_name,
              s.current_monthly_cents AS plan_mrr,
              (
                SELECT COALESCE(SUM(a.amount_cents), 0) FROM addons a
                WHERE a.tenant_id = t.id AND a.kind = 'recurring'
                  AND a.active_until IS NULL
              ) AS addon_mrr
       FROM tenants t
       LEFT JOIN tenant_infra ti ON ti.tenant_id = t.id
       LEFT JOIN subscriptions s ON s.id = (
         SELECT s2.id FROM subscriptions s2
         WHERE s2.tenant_id = t.id AND s2.status = 'active'
         ORDER BY s2.started_on DESC, s2.id DESC LIMIT 1
       )
       LEFT JOIN plans p ON p.code = s.plan_code
       WHERE t.status IN ('active', 'suspended')
       ORDER BY t.trading_name`,
    ),
  ]);

  const byServerId = new Map<number, ServerTenant[]>();
  const byHost = new Map<string, ServerTenant[]>();
  for (const t of tenants) {
    const entry: ServerTenant = {
      id: Number(t.id),
      slug: t.slug,
      tradingName: t.trading_name,
      status: t.status,
      planName: t.plan_name,
      mrrCents: Number(t.plan_mrr ?? 0) + Number(t.addon_mrr ?? 0),
    };
    if (t.server_id != null) {
      const sid = Number(t.server_id);
      const list = byServerId.get(sid) ?? [];
      list.push(entry);
      byServerId.set(sid, list);
    } else {
      const host = String(t.host ?? "").trim() || "(unassigned)";
      const list = byHost.get(host) ?? [];
      list.push(entry);
      byHost.set(host, list);
    }
  }

  const knownIds = new Set(servers.map((s) => Number(s.id)));
  const knownNames = new Set(servers.map((s) => s.name));
  const rows: ServerCapacity[] = servers.map((s) => {
    const id = Number(s.id);
    const assigned = [
      ...(byServerId.get(id) ?? []),
      ...(byHost.get(s.name) ?? []),
    ];
    // Dedupe if both server_id and host matched the same tenant.
    const seen = new Set<number>();
    const unique = assigned.filter((t) => {
      if (seen.has(t.id)) return false;
      seen.add(t.id);
      return true;
    });
    const capacity = Number(s.capacity);
    const usedPct =
      capacity > 0 ? Math.round((unique.length / capacity) * 100) : 0;
    return {
      id,
      name: s.name,
      label: s.label,
      publicIp: s.public_ip,
      capacity,
      notes: s.notes,
      active: Boolean(s.active),
      tenantCount: unique.length,
      usedPct,
      remaining: Math.max(0, capacity - unique.length),
      tone: tone(usedPct),
      tenants: unique,
    };
  });

  for (const [host, assigned] of byHost) {
    if (knownNames.has(host)) continue;
    rows.push({
      id: 0,
      name: host,
      label: "Not registered — add a ceiling for this box",
      publicIp: null,
      capacity: 0,
      notes: null,
      active: true,
      tenantCount: assigned.length,
      usedPct: 0,
      remaining: 0,
      tone: "warn",
      tenants: assigned,
    });
  }

  void knownIds; // reserved for future orphan-id checks
  return rows.sort((a, b) => b.usedPct - a.usedPct || a.name.localeCompare(b.name));
}

/** Slim fill options for the provision form / auto-assign. */
export async function listServerFillOptions(): Promise<ServerFillOption[]> {
  const rows = await listServerCapacity();
  return rows
    .filter((s) => s.id > 0)
    .map((s) => ({
      id: s.id,
      name: s.name,
      label: s.label,
      publicIp: s.publicIp,
      capacity: s.capacity,
      tenantCount: s.tenantCount,
      remaining: s.remaining,
      active: s.active,
    }));
}

/** Which box a single tenant runs on, for linking from the tenant view. */
export async function serverForTenant(
  tenantId: number,
): Promise<{ name: string; capacity: number; tenantCount: number } | null> {
  const rows = await query<
    (RowDataPacket & {
      host: string;
      capacity: number | null;
      tenant_count: number;
    })[]
  >(
    `SELECT ti.host,
            sv.capacity,
            (
              SELECT COUNT(*) FROM tenant_infra ti2
              INNER JOIN tenants t2 ON t2.id = ti2.tenant_id
              WHERE ti2.host = ti.host AND t2.status IN ('active','suspended')
            ) AS tenant_count
     FROM tenant_infra ti
     LEFT JOIN servers sv ON sv.name = ti.host
     WHERE ti.tenant_id = :tenantId
     LIMIT 1`,
    { tenantId },
  );
  const row = rows[0];
  if (!row) return null;
  return {
    name: row.host,
    capacity: Number(row.capacity ?? 0),
    tenantCount: Number(row.tenant_count),
  };
}

function mapServerRow(
  row: RowDataPacket & {
    id: number;
    name: string;
    label: string | null;
    public_ip: string | null;
    db_host: string | null;
    db_port: number | null;
    deploy_path: string | null;
    capacity: number;
    notes: string | null;
    active: number;
    created_at?: string;
    updated_at?: string;
  },
): Server {
  return {
    id: Number(row.id),
    name: String(row.name),
    label: row.label,
    publicIp: row.public_ip,
    dbHost: row.db_host,
    dbPort: row.db_port == null ? null : Number(row.db_port),
    deployPath: row.deploy_path,
    capacity: Number(row.capacity),
    active: Boolean(row.active),
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const SERVER_SELECT = `SELECT id, name, label, public_ip, db_host, db_port,
       deploy_path, capacity, notes, active, created_at, updated_at
     FROM servers`;

export async function getServerById(id: number): Promise<Server | null> {
  const rows = await query<
    (RowDataPacket & {
      id: number;
      name: string;
      label: string | null;
      public_ip: string | null;
      db_host: string | null;
      db_port: number | null;
      deploy_path: string | null;
      capacity: number;
      notes: string | null;
      active: number;
      created_at?: string;
      updated_at?: string;
    })[]
  >(`${SERVER_SELECT} WHERE id = :id LIMIT 1`, { id });
  const row = rows[0];
  return row ? mapServerRow(row) : null;
}

export async function getServerByName(name: string): Promise<Server | null> {
  const rows = await query<
    (RowDataPacket & {
      id: number;
      name: string;
      label: string | null;
      public_ip: string | null;
      db_host: string | null;
      db_port: number | null;
      deploy_path: string | null;
      capacity: number;
      notes: string | null;
      active: number;
      created_at?: string;
      updated_at?: string;
    })[]
  >(`${SERVER_SELECT} WHERE name = :name LIMIT 1`, {
    name: name.trim().toLowerCase(),
  });
  const row = rows[0];
  return row ? mapServerRow(row) : null;
}
