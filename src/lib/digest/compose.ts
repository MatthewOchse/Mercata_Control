import {
  busiestSalesDay,
  salesFromWarehouse,
  trafficFromWarehouse,
} from "@/lib/analytics/queries";
import { resolveTenantBrand } from "@/lib/digest/brand";
import { periodsForDigest } from "@/lib/digest/period";
import { fleetAnalyticsSource } from "@/lib/digest/sources/fleet";
import { ga4AnalyticsSource } from "@/lib/digest/sources/ga4";
import type {
  DigestCadence,
  DigestPayload,
  SalesMetrics,
} from "@/lib/digest/types";
import { aovCents } from "@/lib/digest/types";
import { unsubscribeUrl } from "@/lib/digest/unsubscribe";

const emptySales = (): SalesMetrics => ({
  ordersCount: 0,
  grossSalesCents: 0,
  refundsCents: 0,
  netSalesCents: 0,
  averageOrderValueCents: 0,
  eventsBookingsCount: null,
  eventsGrossCents: null,
  eventsSpaces: null,
  topProducts: [],
  customers: { new: 0, returning: 0 },
  pageViews: null,
});

export type DigestTenantInput = {
  id: number;
  slug: string;
  trading_name: string;
  digest_cadence: DigestCadence;
  digest_day: number;
  ga4_property_id: string | null;
  ga4_verified_at?: string | null;
  brand_primary_color: string | null;
  brand_logo_url: string | null;
  primary_domain: string | null;
  fleet_secret: string | null;
};

async function loadSales(
  tenant: DigestTenantInput,
  from: string,
  to: string,
): Promise<SalesMetrics> {
  const wh = await salesFromWarehouse(tenant.id, from, to);
  if (wh) {
    return {
      ordersCount: wh.ordersCount,
      grossSalesCents: wh.grossSalesCents,
      refundsCents: wh.refundsCents,
      netSalesCents: wh.netSalesCents,
      averageOrderValueCents: aovCents(wh.netSalesCents, wh.ordersCount),
      eventsBookingsCount: null,
      eventsGrossCents: null,
      eventsSpaces: null,
      topProducts: wh.topProducts,
      customers: { new: 0, returning: 0 },
      pageViews: null,
    };
  }
  if (!tenant.primary_domain || !tenant.fleet_secret) {
    return emptySales();
  }
  return fleetAnalyticsSource.fetchSales({
    tenantId: tenant.id,
    slug: tenant.slug,
    primaryDomain: tenant.primary_domain,
    fleetSecretCipher: tenant.fleet_secret,
    from,
    to,
  });
}

/**
 * Build a full digest payload for preview or send.
 * Prefer analytics_daily warehouse; fall back to live fleet/GA4.
 * Secondary sources never fail the digest.
 */
export async function buildDigestPayload(
  tenant: DigestTenantInput,
  recipientEmail: string,
  opts?: {
    sendDate?: string;
    cadenceOverride?: "daily" | "weekly" | "monthly";
  },
): Promise<DigestPayload> {
  const cadence =
    opts?.cadenceOverride ??
    (tenant.digest_cadence === "off"
      ? "weekly"
      : (tenant.digest_cadence as "daily" | "weekly" | "monthly"));

  const { period, previous } = periodsForDigest(cadence, opts?.sendDate);

  if (!tenant.primary_domain || !tenant.fleet_secret) {
    throw new Error(
      `Tenant ${tenant.slug} is missing primary_domain or fleet_secret`,
    );
  }

  const [sales, previousSales, brand, busiest] = await Promise.all([
    loadSales(tenant, period.from, period.to).catch(() => emptySales()),
    loadSales(tenant, previous.from, previous.to).catch(() => emptySales()),
    resolveTenantBrand({
      tradingName: tenant.trading_name,
      primaryDomain: tenant.primary_domain,
      fleetSecretCipher: tenant.fleet_secret,
      storedPrimary: tenant.brand_primary_color,
      storedLogoUrl: tenant.brand_logo_url,
    }),
    busiestSalesDay(tenant.id, period.from, period.to),
  ]);

  let traffic = await trafficFromWarehouse(
    tenant.id,
    period.from,
    period.to,
  );

  if (
    !traffic &&
    tenant.ga4_property_id?.trim() &&
    tenant.ga4_verified_at &&
    ga4AnalyticsSource.fetchTraffic
  ) {
    traffic = await ga4AnalyticsSource.fetchTraffic({
      tenantId: tenant.id,
      ga4PropertyId: tenant.ga4_property_id,
      from: period.from,
      to: period.to,
    });
  }

  // Never present a zero as "unknown" for traffic — omit entirely.
  if (traffic && traffic.sessions === 0 && traffic.users === 0) {
    // Keep zeros when we know the property was measured and truly had no traffic.
  }

  const conversionRate =
    traffic && traffic.sessions > 0
      ? Math.round((sales.ordersCount / traffic.sessions) * 10000) / 100
      : traffic
        ? 0
        : null;

  const contextLine = busiest
    ? `Your busiest day was ${busiest}.`
    : sales.ordersCount > 0
      ? null
      : "No sales in this period.";

  return {
    tenantId: tenant.id,
    slug: tenant.slug,
    brand,
    cadence,
    period,
    previous,
    sales,
    previousSales,
    traffic,
    conversionRate,
    contextLine,
    showSettleNote: cadence === "daily" || cadence === "weekly",
    unsubscribeUrl: unsubscribeUrl(tenant.id, recipientEmail),
  };
}
