import { google } from "googleapis";
import type { AnalyticsSource, TrafficMetrics } from "@/lib/digest/types";

function serviceAccountCredentials(): object | null {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim();
  if (!raw) return null;
  try {
    return JSON.parse(raw) as object;
  } catch {
    return null;
  }
}

/**
 * Optional GA4 source. Returns null traffic (never throws to the caller path)
 * when the property is unset, credentials missing, or the API fails.
 */
export const ga4AnalyticsSource: Pick<AnalyticsSource, "name" | "fetchTraffic"> =
  {
    name: "ga4",

    async fetchTraffic(opts): Promise<TrafficMetrics | null> {
      const credentials = serviceAccountCredentials();
      if (!credentials || !opts.ga4PropertyId.trim()) return null;

      try {
        const auth = new google.auth.GoogleAuth({
          credentials,
          scopes: ["https://www.googleapis.com/auth/analytics.readonly"],
        });
        const analyticsdata = google.analyticsdata({
          version: "v1beta",
          auth,
        });
        const property = opts.ga4PropertyId.startsWith("properties/")
          ? opts.ga4PropertyId
          : `properties/${opts.ga4PropertyId}`;

        const [summary, pages, sources] = await Promise.all([
          analyticsdata.properties.runReport({
            property,
            requestBody: {
              dateRanges: [{ startDate: opts.from, endDate: opts.to }],
              metrics: [{ name: "sessions" }, { name: "totalUsers" }],
            },
          }),
          analyticsdata.properties.runReport({
            property,
            requestBody: {
              dateRanges: [{ startDate: opts.from, endDate: opts.to }],
              dimensions: [{ name: "pagePath" }],
              metrics: [{ name: "screenPageViews" }],
              orderBys: [
                { metric: { metricName: "screenPageViews" }, desc: true },
              ],
              limit: "5",
            },
          }),
          analyticsdata.properties.runReport({
            property,
            requestBody: {
              dateRanges: [{ startDate: opts.from, endDate: opts.to }],
              dimensions: [{ name: "sessionDefaultChannelGroup" }],
              metrics: [{ name: "sessions" }],
              orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
              limit: "5",
            },
          }),
        ]);

        const summaryRow = summary.data.rows?.[0]?.metricValues;
        const sessions = Number(summaryRow?.[0]?.value ?? 0);
        const users = Number(summaryRow?.[1]?.value ?? 0);

        const topPages = (pages.data.rows ?? []).map((row) => ({
          path: row.dimensionValues?.[0]?.value ?? "/",
          views: Number(row.metricValues?.[0]?.value ?? 0),
        }));

        const topSources = (sources.data.rows ?? []).map((row) => ({
          source: row.dimensionValues?.[0]?.value ?? "(unknown)",
          sessions: Number(row.metricValues?.[0]?.value ?? 0),
        }));

        return { sessions, users, topPages, topSources };
      } catch (err) {
        console.error(
          `[digest/ga4] tenant=${opts.tenantId} property=${opts.ga4PropertyId}:`,
          err instanceof Error ? err.message : err,
        );
        return null;
      }
    },
  };
