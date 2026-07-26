/**
 * After a successful provision, bind the CRM tenant to the chosen Server.
 * Updates tenants.server_id and tenant_infra.host when rows exist; creates a
 * minimal active tenant + infra when the slug is new.
 */
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { encryptSecret } from "@/lib/crypto/secrets";
import { withTransaction } from "@/lib/db/pool";

export async function assignTenantToServer(opts: {
  tenantSlug: string;
  displayName?: string | null;
  domain: string;
  dbName: string;
  serverId: number;
  serverName: string;
  fleetSecretPlain: string;
  /** Billing plan to attach when creating/activating CRM tenant. */
  planCode?: string | null;
}): Promise<{ tenantId: number; created: boolean }> {
  const slug = opts.tenantSlug.trim().toLowerCase();
  const domain = opts.domain.trim().toLowerCase();
  const display =
    opts.displayName?.trim() ||
    slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  const fleetCipher = encryptSecret(opts.fleetSecretPlain);
  const planCode = opts.planCode?.trim() || null;

  return withTransaction(async (conn) => {
    const [existing] = await conn.execute<(RowDataPacket & { id: number })[]>(
      `SELECT id FROM tenants WHERE slug = ? LIMIT 1`,
      [slug],
    );
    let tenantId = existing[0] ? Number(existing[0].id) : 0;
    let created = false;

    if (!tenantId) {
      const [ins] = await conn.execute<ResultSetHeader>(
        `INSERT INTO tenants
           (server_id, slug, legal_name, trading_name, status, onboarded_at)
         VALUES (?, ?, ?, ?, 'active', UTC_TIMESTAMP(3))`,
        [opts.serverId, slug, display, display],
      );
      tenantId = Number(ins.insertId);
      created = true;
    } else {
      await conn.execute(
        `UPDATE tenants SET server_id = ?, status = IF(status = 'prospect', 'active', status),
            onboarded_at = COALESCE(onboarded_at, UTC_TIMESTAMP(3))
         WHERE id = ?`,
        [opts.serverId, tenantId],
      );
    }

    const [infra] = await conn.execute<(RowDataPacket & { id: number })[]>(
      `SELECT id FROM tenant_infra WHERE tenant_id = ? LIMIT 1`,
      [tenantId],
    );
    if (infra[0]) {
      await conn.execute(
        `UPDATE tenant_infra
         SET host = ?, primary_domain = ?, db_name = ?, container_name = ?,
             fleet_secret = ?
         WHERE tenant_id = ?`,
        [
          opts.serverName,
          domain,
          opts.dbName,
          slug,
          fleetCipher,
          tenantId,
        ],
      );
    } else {
      await conn.execute(
        `INSERT INTO tenant_infra
           (tenant_id, primary_domain, extra_domains, container_name, db_name, host, fleet_secret)
         VALUES (?, ?, NULL, ?, ?, ?, ?)`,
        [tenantId, domain, slug, opts.dbName, opts.serverName, fleetCipher],
      );
    }

    if (planCode) {
      const [planRows] = await conn.execute<
        (RowDataPacket & { monthly_cents: number })[]
      >(`SELECT monthly_cents FROM plans WHERE code = ? AND active = 1 LIMIT 1`, [
        planCode,
      ]);
      const monthly = planRows[0] ? Number(planRows[0].monthly_cents) : 0;
      const [subs] = await conn.execute<(RowDataPacket & { id: number })[]>(
        `SELECT id FROM subscriptions
         WHERE tenant_id = ? AND status = 'active' AND ends_on IS NULL
         ORDER BY id DESC LIMIT 1`,
        [tenantId],
      );
      if (subs[0]) {
        await conn.execute(
          `UPDATE subscriptions SET plan_code = ?, current_monthly_cents = ?
           WHERE id = ?`,
          [planCode, monthly, Number(subs[0].id)],
        );
      } else {
        await conn.execute(
          `INSERT INTO subscriptions
             (tenant_id, plan_code, status, started_on, ends_on, current_monthly_cents)
           VALUES (?, ?, 'active', CURDATE(), NULL, ?)`,
          [tenantId, planCode, monthly],
        );
      }
    }

    return { tenantId, created };
  });
}
