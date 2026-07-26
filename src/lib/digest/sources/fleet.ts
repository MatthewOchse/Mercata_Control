import { decryptSecret } from "@/lib/crypto/secrets";
import { fetchFleetAuthorized } from "@/lib/health/fleet-fetch";
import {
  aovCents,
  type AnalyticsSource,
  type SalesMetrics,
} from "@/lib/digest/types";

function normaliseDomain(domain: string): string {
  return domain
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/$/, "");
}

type FleetStatsJson = {
  orders_count?: number;
  gross_sales_cents?: number;
  refunds_cents?: number;
  net_sales_cents?: number;
  events_bookings_count?: number;
  events_gross_cents?: number;
  events_spaces?: number;
  top_products?: Array<{
    stock_code?: string;
    description?: string;
    units?: number;
  }>;
  customers?: { new?: number; returning?: number };
  page_views?: number | null;
  error?: string;
};

function mapFleetStats(json: FleetStatsJson): SalesMetrics {
  const ordersCount = Number(json.orders_count ?? 0);
  const netSalesCents = Number(json.net_sales_cents ?? 0);
  const hasEvents =
    json.events_bookings_count !== undefined ||
    json.events_gross_cents !== undefined;
  return {
    ordersCount,
    grossSalesCents: Number(json.gross_sales_cents ?? 0),
    refundsCents: Number(json.refunds_cents ?? 0),
    netSalesCents,
    averageOrderValueCents: aovCents(netSalesCents, ordersCount),
    eventsBookingsCount: hasEvents
      ? Number(json.events_bookings_count ?? 0)
      : null,
    eventsGrossCents: hasEvents ? Number(json.events_gross_cents ?? 0) : null,
    eventsSpaces: hasEvents ? Number(json.events_spaces ?? 0) : null,
    topProducts: (json.top_products ?? []).slice(0, 5).map((p) => ({
      description: p.description?.trim() || p.stock_code || "Product",
      units: Number(p.units ?? 0),
      stockCode: p.stock_code,
    })),
    customers: {
      new: Number(json.customers?.new ?? 0),
      returning: Number(json.customers?.returning ?? 0),
    },
    pageViews:
      json.page_views === null || json.page_views === undefined
        ? null
        : Number(json.page_views),
  };
}

export const fleetAnalyticsSource: AnalyticsSource = {
  name: "fleet",

  async fetchSales(opts) {
    const host = normaliseDomain(opts.primaryDomain);
    const secret = decryptSecret(opts.fleetSecretCipher);
    const url = new URL(`https://${host}/api/_fleet/stats`);
    url.searchParams.set("from", opts.from);
    url.searchParams.set("to", opts.to);

    const res = await fetchFleetAuthorized(url.toString(), secret, {
      timeoutMs: 20000,
      userAgent: "MercataControl/digest-stats",
    });
    if (!res.ok) {
      throw new Error(`Fleet stats HTTP ${res.status}`);
    }
    const json = (await res.json()) as FleetStatsJson;
    if (json.error) {
      throw new Error(`Fleet stats: ${json.error}`);
    }
    return mapFleetStats(json);
  },
};
