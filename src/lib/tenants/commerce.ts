import {
  resolveDetailRange,
  type DetailRange,
} from "@/lib/analytics/detail-range";
import { fleetAnalyticsSource } from "@/lib/digest/sources/fleet";
import type { FleetHealthPayload } from "@/lib/health/types";
import { planExpectsOrders } from "@/lib/health/types";
import { query } from "@/lib/db/pool";
import type { RowDataPacket } from "mysql2/promise";
import {
  getSubscriptions,
  getTenantInfra,
  currentSubscription,
} from "@/lib/tenants/queries";

export type CommerceSites = { kind: "sites" };

export type CommerceShop = {
  kind: "shop";
  orders: number;
  netSalesCents: number;
  /** Paid event bookings included in net sales. Null when unknown (warehouse). */
  eventsBookingsCount: number | null;
  eventsGrossCents: number | null;
  eventsSpaces: number | null;
  periodFrom: string;
  periodTo: string;
  range: DetailRange;
  periodComplete: boolean;
  productsListed: number | null;
  lastOrderAt: string | null;
  source: "warehouse" | "fleet";
};

export type CommerceResult = CommerceSites | CommerceShop;

function parseHealthPayload(raw: unknown): FleetHealthPayload | null {
  if (!raw) return null;
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as FleetHealthPayload;
    } catch {
      return null;
    }
  }
  if (typeof raw === "object") return raw as FleetHealthPayload;
  return null;
}

async function latestHealthStorefront(tenantId: number): Promise<{
  productsListed: number | null;
  lastOrderAt: string | null;
}> {
  const rows = await query<(RowDataPacket & { payload: unknown })[]>(
    `SELECT payload FROM health_checks
     WHERE tenant_id = :tenantId
     ORDER BY checked_at DESC LIMIT 1`,
    { tenantId },
  );
  const payload = parseHealthPayload(rows[0]?.payload);
  return {
    productsListed:
      payload?.storefront?.products_visible === undefined
        ? null
        : Number(payload.storefront.products_visible),
    lastOrderAt: payload?.storefront?.last_order_at ?? null,
  };
}

async function warehousePeriod(
  tenantId: number,
  from: string,
  to: string,
): Promise<{ orders: number; netSalesCents: number; daysWithData: number } | null> {
  const rows = await query<
    (RowDataPacket & { orders: number; net: number; n: number })[]
  >(
    `SELECT COALESCE(SUM(orders), 0) AS orders,
            COALESCE(SUM(net_cents), 0) AS net,
            COUNT(*) AS n
     FROM analytics_daily
     WHERE tenant_id = :tid AND source = 'internal'
       AND date BETWEEN :from AND :to`,
    { tid: tenantId, from, to },
  );
  const daysWithData = Number(rows[0]?.n ?? 0);
  if (daysWithData === 0) return null;
  return {
    orders: Number(rows[0]?.orders ?? 0),
    netSalesCents: Number(rows[0]?.net ?? 0),
    daysWithData,
  };
}

function expectedDaysInclusive(from: string, to: string): number {
  const a = new Date(`${from}T00:00:00Z`).getTime();
  const b = new Date(`${to}T00:00:00Z`).getTime();
  return Math.max(1, Math.round((b - a) / 86_400_000) + 1);
}

export async function getCommerce(opts: {
  tenantId: number;
  slug: string;
  range: DetailRange;
}): Promise<CommerceResult> {
  const [subs, infra] = await Promise.all([
    getSubscriptions(opts.tenantId),
    getTenantInfra(opts.tenantId),
  ]);
  const planCode = currentSubscription(subs)?.plan_code ?? null;

  if (!planExpectsOrders(planCode)) {
    return { kind: "sites" };
  }

  const { from, to } = resolveDetailRange(opts.range);
  const storefront = await latestHealthStorefront(opts.tenantId);

  if (infra?.primary_domain && infra.fleet_secret) {
    try {
      const sales = await fleetAnalyticsSource.fetchSales({
        tenantId: opts.tenantId,
        slug: opts.slug,
        primaryDomain: infra.primary_domain,
        fleetSecretCipher: infra.fleet_secret,
        from,
        to,
      });
      return {
        kind: "shop",
        orders: sales.ordersCount,
        netSalesCents: sales.netSalesCents,
        eventsBookingsCount: sales.eventsBookingsCount,
        eventsGrossCents: sales.eventsGrossCents,
        eventsSpaces: sales.eventsSpaces,
        periodFrom: from,
        periodTo: to,
        range: opts.range,
        periodComplete: true,
        productsListed: storefront.productsListed,
        lastOrderAt: storefront.lastOrderAt,
        source: "fleet",
      };
    } catch {
      // fall through to warehouse
    }
  }

  const wh = await warehousePeriod(opts.tenantId, from, to);
  if (wh) {
    return {
      kind: "shop",
      orders: wh.orders,
      netSalesCents: wh.netSalesCents,
      eventsBookingsCount: null,
      eventsGrossCents: null,
      eventsSpaces: null,
      periodFrom: from,
      periodTo: to,
      range: opts.range,
      periodComplete: wh.daysWithData >= expectedDaysInclusive(from, to) - 2,
      productsListed: storefront.productsListed,
      lastOrderAt: storefront.lastOrderAt,
      source: "warehouse",
    };
  }

  return {
    kind: "shop",
    orders: 0,
    netSalesCents: 0,
    eventsBookingsCount: null,
    eventsGrossCents: null,
    eventsSpaces: null,
    periodFrom: from,
    periodTo: to,
    range: opts.range,
    periodComplete: false,
    productsListed: storefront.productsListed,
    lastOrderAt: storefront.lastOrderAt,
    source: "warehouse",
  };
}
