import { NextResponse } from "next/server";
import { runAnalyticsEtl } from "@/lib/analytics/etl";
import { authorizeCron } from "@/lib/health/cron-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Nightly analytics ETL.
 * Schedule: 03:00 SAST (01:00 UTC).
 * Auth: Bearer $CRON_SECRET
 */
export async function GET(request: Request) {
  const denied = authorizeCron(request);
  if (denied) return denied;

  try {
    const summary = await runAnalyticsEtl();
    return NextResponse.json({ ok: true, ...summary });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : "analytics etl failed",
      },
      { status: 500 },
    );
  }
}
