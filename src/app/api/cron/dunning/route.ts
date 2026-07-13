import { NextResponse } from "next/server";
import { runDunningLadder } from "@/lib/billing/dunning";
import { authorizeCron } from "@/lib/health/cron-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** Daily 08:00 SAST — dunning ladder. Auth: Bearer $CRON_SECRET */
export async function GET(request: Request) {
  const denied = authorizeCron(request);
  if (denied) return denied;

  try {
    const summary = await runDunningLadder();
    return NextResponse.json({ ok: true, ...summary });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : "dunning failed",
      },
      { status: 500 },
    );
  }
}
