import { resolveTenantBrand } from "@/lib/digest/brand";
import { periodsForDigest } from "@/lib/digest/period";
import { fleetAnalyticsSource } from "@/lib/digest/sources/fleet";
import { ga4AnalyticsSource } from "@/lib/digest/sources/ga4";
import type {
  DigestCadence,
  DigestPayload,
  SalesMetrics,
} from "@/lib/digest/types";
import { unsubscribeUrl } from "@/lib/digest/unsubscribe";

const emptySales = (): SalesMetrics => ({
  ordersCount: 0,
  grossSalesCents: 0,
  refundsCents: 0,
  netSalesCents: 0,
  averageOrderValueCents: 0,
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
  brand_primary_color: string | null;
  brand_logo_url: string | null;
  primary_domain: string | null;
  fleet_secret: string | null;
};

/**
 * Build a full digest payload for preview or send.
 * Sales come from fleet (required). GA4 traffic is optional and never fails the digest.
 */
export async function buildDigestPayload(
  tenant: DigestTenantInput,
  recipientEmail: string,
  opts?: { sendDate?: string; cadenceOverride?: "daily" | "weekly" },
): Promise<DigestPayload> {
  const cadence =
    opts?.cadenceOverride ??
    (tenant.digest_cadence === "off"
      ? "weekly"
      : (tenant.digest_cadence as "daily" | "weekly"));

  const { period, previous } = periodsForDigest(cadence, opts?.sendDate);

  if (!tenant.primary_domain || !tenant.fleet_secret) {
    throw new Error(
      `Tenant ${tenant.slug} is missing primary_domain or fleet_secret`,
    );
  }

  const salesOpts = {
    tenantId: tenant.id,
    slug: tenant.slug,
    primaryDomain: tenant.primary_domain,
    fleetSecretCipher: tenant.fleet_secret,
  };

  const [sales, previousSales, brand] = await Promise.all([
    fleetAnalyticsSource.fetchSales({
      ...salesOpts,
      from: period.from,
      to: period.to,
    }),
    fleetAnalyticsSource
      .fetchSales({
        ...salesOpts,
        from: previous.from,
        to: previous.to,
      })
      .catch(() => emptySales()),
    resolveTenantBrand({
      tradingName: tenant.trading_name,
      primaryDomain: tenant.primary_domain,
      fleetSecretCipher: tenant.fleet_secret,
      storedPrimary: tenant.brand_primary_color,
      storedLogoUrl: tenant.brand_logo_url,
    }),
  ]);

  let traffic = null;
  if (tenant.ga4_property_id?.trim() && ga4AnalyticsSource.fetchTraffic) {
    traffic = await ga4AnalyticsSource.fetchTraffic({
      tenantId: tenant.id,
      ga4PropertyId: tenant.ga4_property_id,
      from: period.from,
      to: period.to,
    });
  }

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
    unsubscribeUrl: unsubscribeUrl(tenant.id, recipientEmail),
  };
}
