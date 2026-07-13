/**
 * Analytics sources for customer digests.
 * Fleet stats = sales source of truth; GA4 = optional traffic.
 */
export type { AnalyticsSource, SalesMetrics, TrafficMetrics } from "@/lib/digest/types";
export { fleetAnalyticsSource } from "@/lib/digest/sources/fleet";
export { ga4AnalyticsSource } from "@/lib/digest/sources/ga4";
