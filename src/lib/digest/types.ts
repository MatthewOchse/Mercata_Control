export type DigestCadence = "daily" | "weekly" | "off";

export type SalesMetrics = {
  ordersCount: number;
  grossSalesCents: number;
  refundsCents: number;
  netSalesCents: number;
  averageOrderValueCents: number;
  topProducts: Array<{
    description: string;
    units: number;
    stockCode?: string;
  }>;
  customers: { new: number; returning: number };
  pageViews: number | null;
};

export type TrafficMetrics = {
  sessions: number;
  users: number;
  topPages: Array<{ path: string; views: number }>;
  topSources: Array<{ source: string; sessions: number }>;
};

export type PeriodWindow = {
  from: string; // YYYY-MM-DD inclusive
  to: string; // YYYY-MM-DD inclusive
  label: string;
};

export type DigestBrand = {
  tradingName: string;
  primaryColor: string;
  logoUrl: string | null;
};

export type DigestPayload = {
  tenantId: number;
  slug: string;
  brand: DigestBrand;
  cadence: "daily" | "weekly";
  period: PeriodWindow;
  previous: PeriodWindow;
  sales: SalesMetrics;
  previousSales: SalesMetrics;
  traffic: TrafficMetrics | null;
  unsubscribeUrl: string;
};

export interface AnalyticsSource {
  readonly name: string;
  fetchSales(opts: {
    tenantId: number;
    slug: string;
    primaryDomain: string;
    fleetSecretCipher: string;
    from: string;
    to: string;
  }): Promise<SalesMetrics>;
  fetchTraffic?(opts: {
    tenantId: number;
    ga4PropertyId: string;
    from: string;
    to: string;
  }): Promise<TrafficMetrics | null>;
}

export function pctChange(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

export function aovCents(netSalesCents: number, ordersCount: number): number {
  if (ordersCount <= 0) return 0;
  return Math.trunc(netSalesCents / ordersCount);
}
