import { NextResponse } from "next/server";
import { runDigestSends } from "@/lib/digest/send";
import { authorizeCron } from "@/lib/health/cron-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Customer analytics digests.
 * Schedule: 07:00 SAST (05:00 UTC) daily — weekly tenants send on digest_day (default Mon).
 * Auth: Bearer $CRON_SECRET
 */
export async function GET(request: Request) {
  const denied = authorizeCron(request);
  if (denied) return denied;

  try {
    const summary = await runDigestSends();
    return NextResponse.json({ ok: true, ...summary });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : "digests failed",
      },
      { status: 500 },
    );
  }
}
