import { NextResponse } from "next/server";
import { authorizeCron } from "@/lib/health/cron-auth";
import { runHealthPollCycle } from "@/lib/health/poller";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** Cron: every 3 minutes. Auth: Authorization: Bearer $CRON_SECRET */
export async function GET(request: Request) {
  const denied = authorizeCron(request);
  if (denied) return denied;

  try {
    const summary = await runHealthPollCycle();
    return NextResponse.json({ ok: true, ...summary });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : "poll failed",
      },
      { status: 500 },
    );
  }
}
