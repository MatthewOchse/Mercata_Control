#!/usr/bin/env tsx
/**
 * Seed the two live tenants (idempotent).
 * Usage: npm run seed:tenants
 *
 * Creates crafties + geist as active with placeholder plan/contact details
 * so you can edit through the UI.
 */
import "dotenv/config";
import mysql from "mysql2/promise";
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { encryptSecret, generateFleetSecret } from "../src/lib/crypto/secrets";

type SeedTenant = {
  slug: string;
  legalName: string;
  tradingName: string;
  notes: string;
  domain: string;
  brandPrimary: string;
  primary: { name: string; email: string };
  billing: { name: string; email: string };
  planCode: string;
};

const SEEDS: SeedTenant[] = [
  {
    slug: "crafties",
    legalName: "Crafties",
    tradingName: "Crafties",
    notes: "Benoni — craft supplies. Placeholder contact/plan — edit in UI.",
    domain: "crafties.co.za",
    brandPrimary: "#2B6CB0",
    primary: { name: "Crafties Owner", email: "owner@crafties.co.za" },
    billing: { name: "Crafties Billing", email: "billing@crafties.co.za" },
    planCode: "retail",
  },
  {
    slug: "geist",
    legalName: "Geist Leathercare",
    tradingName: "Geist Leathercare",
    notes: "Placeholder contact/plan — edit in UI.",
    domain: "geist.co.za",
    brandPrimary: "#0A3A33",
    primary: { name: "Geist Owner", email: "owner@geist.co.za" },
    billing: { name: "Geist Billing", email: "billing@geist.co.za" },
    planCode: "online",
  },
];

async function main() {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) {
    console.error("DATABASE_URL is required");
    process.exit(1);
  }

  const conn = await mysql.createConnection(url);
  try {
    for (const seed of SEEDS) {
      const [existing] = await conn.execute<RowDataPacket[]>(
        `SELECT id FROM tenants WHERE slug = ? LIMIT 1`,
        [seed.slug],
      );
      if (existing[0]) {
        console.log(`skip ${seed.slug} (already exists)`);
        continue;
      }

      const [planRows] = await conn.execute<
        (RowDataPacket & { monthly_cents: number })[]
      >(`SELECT monthly_cents FROM plans WHERE code = ? LIMIT 1`, [
        seed.planCode,
      ]);
      const monthly = Number(planRows[0]?.monthly_cents);
      if (!monthly) throw new Error(`Plan missing: ${seed.planCode}`);

      const [serverRows] = await conn.execute<(RowDataPacket & { id: number })[]>(
        `SELECT id FROM servers WHERE name = 'caesar' LIMIT 1`,
      );
      const serverId = Number(serverRows[0]?.id);
      if (!serverId) {
        throw new Error(
          "Server caesar is not registered — apply migration 022 first",
        );
      }

      const [tenantResult] = await conn.execute<ResultSetHeader>(
        `INSERT INTO tenants
           (server_id, slug, legal_name, trading_name, status, onboarded_at, notes, brand_primary_color)
         VALUES (?, ?, ?, ?, 'active', UTC_TIMESTAMP(3), ?, ?)`,
        [
          serverId,
          seed.slug,
          seed.legalName,
          seed.tradingName,
          seed.notes,
          seed.brandPrimary,
        ],
      );
      const tenantId = Number(tenantResult.insertId);

      await conn.execute(
        `INSERT INTO tenant_contacts (tenant_id, name, email, role, is_primary)
         VALUES (?, ?, ?, 'primary', 1)`,
        [tenantId, seed.primary.name, seed.primary.email],
      );
      await conn.execute(
        `INSERT INTO tenant_contacts (tenant_id, name, email, role, is_primary)
         VALUES (?, ?, ?, 'billing', 0)`,
        [tenantId, seed.billing.name, seed.billing.email],
      );

      const cipher = encryptSecret(generateFleetSecret());
      await conn.execute(
        `INSERT INTO tenant_infra
           (tenant_id, primary_domain, container_name, db_name, host, fleet_secret)
         VALUES (?, ?, ?, ?, 'caesar', ?)`,
        [
          tenantId,
          seed.domain,
          seed.slug,
          seed.slug.replace(/-/g, "_"),
          cipher,
        ],
      );

      const today = new Date().toISOString().slice(0, 10);
      await conn.execute(
        `INSERT INTO subscriptions
           (tenant_id, plan_code, status, started_on, ends_on, current_monthly_cents)
         VALUES (?, ?, 'active', ?, NULL, ?)`,
        [tenantId, seed.planCode, today, monthly],
      );

      await conn.execute(
        `INSERT INTO audit_log (actor, action, entity_type, entity_id, after_json)
         VALUES ('seed', 'tenant.seed', 'tenant', ?, CAST(? AS JSON))`,
        [
          String(tenantId),
          JSON.stringify({ slug: seed.slug, status: "active", seeded: true }),
        ],
      );

      console.log(`created ${seed.slug} (active, plan=${seed.planCode})`);
    }
  } finally {
    await conn.end();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
