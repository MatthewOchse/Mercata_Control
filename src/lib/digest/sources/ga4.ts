import { fetchGa4PeriodTraffic } from "@/lib/analytics/ga4";
import type { AnalyticsSource, TrafficMetrics } from "@/lib/digest/types";

/**
 * Optional GA4 source. Returns null traffic (never throws to the caller path)
 * when the property is unset, credentials missing, or the API fails.
 */
export const ga4AnalyticsSource: Pick<AnalyticsSource, "name" | "fetchTraffic"> =
  {
    name: "ga4",

    async fetchTraffic(opts): Promise<TrafficMetrics | null> {
      if (!opts.ga4PropertyId.trim()) return null;
      const traffic = await fetchGa4PeriodTraffic({
        propertyId: opts.ga4PropertyId,
        from: opts.from,
        to: opts.to,
      });
      if (!traffic) return null;
      return {
        sessions: traffic.sessions,
        users: traffic.users,
        topPages: traffic.topPages.slice(0, 5),
        topSources: traffic.topSources.slice(0, 5),
      };
    },
  };
