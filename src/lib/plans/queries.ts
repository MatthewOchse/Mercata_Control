import type { RowDataPacket } from "mysql2/promise";
import { query } from "@/lib/db/pool";

export type ProductLine = "retail" | "sites";

export type PlanRecord = {
  /** Primary key and slug — plans are keyed by code, not a surrogate id. */
  code: string;
  name: string;
  productLine: ProductLine;
  monthlyCents: number;
  /** 0 for flat tiers, 0.02 for Starter. */
  commissionRate: number;
  commissionBasis: "gross";
  graduationThresholdCents: number | null;
  graduateToCode: string | null;
  eligibility: string | null;
  sortOrder: number;
  active: boolean;
  tenantCount: number;
};

type Row = RowDataPacket & {
  code: string;
  name: string;
  product_line: string;
  monthly_cents: number;
  commission_rate: string | number;
  commission_basis: string;
  graduation_threshold_cents: number | null;
  graduate_to_code: string | null;
  eligibility: string | null;
  sort_order: number;
  active: number;
  tenant_count: number;
};

function mapRow(r: Row): PlanRecord {
  return {
    code: r.code,
    name: r.name,
    productLine: r.product_line === "sites" ? "sites" : "retail",
    monthlyCents: Number(r.monthly_cents),
    commissionRate: Number(r.commission_rate),
    commissionBasis: "gross",
    graduationThresholdCents:
      r.graduation_threshold_cents === null
        ? null
        : Number(r.graduation_threshold_cents),
    graduateToCode: r.graduate_to_code,
    eligibility: r.eligibility,
    sortOrder: Number(r.sort_order),
    active: Boolean(r.active),
    tenantCount: Number(r.tenant_count ?? 0),
  };
}

const SELECT_PLANS = `
  SELECT p.code, p.name, p.product_line, p.monthly_cents, p.commission_rate,
         p.commission_basis, p.graduation_threshold_cents, p.graduate_to_code,
         p.eligibility, p.sort_order, p.active,
         (
           SELECT COUNT(DISTINCT s.tenant_id) FROM subscriptions s
           INNER JOIN tenants t ON t.id = s.tenant_id
           WHERE s.plan_code = p.code AND s.status = 'active'
             AND t.status IN ('active', 'suspended')
         ) AS tenant_count
  FROM plans p`;

export async function listPlans(): Promise<PlanRecord[]> {
  const rows = await query<Row[]>(
    `${SELECT_PLANS} ORDER BY p.active DESC, p.sort_order, p.name`,
  );
  return rows.map(mapRow);
}

export async function getPlan(code: string): Promise<PlanRecord | null> {
  const rows = await query<Row[]>(`${SELECT_PLANS} WHERE p.code = :code LIMIT 1`, {
    code,
  });
  const row = rows[0];
  return row ? mapRow(row) : null;
}

/** Plans that levy commission — used by the graduation monitor and dashboards. */
export async function listCommissionPlans(): Promise<PlanRecord[]> {
  const rows = await query<Row[]>(
    `${SELECT_PLANS} WHERE p.commission_rate > 0 ORDER BY p.sort_order`,
  );
  return rows.map(mapRow);
}
