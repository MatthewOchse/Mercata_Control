import { NextResponse } from "next/server";
import { authorizeCron } from "@/lib/health/cron-auth";
import { runMonthlySalesSnapshot } from "@/lib/sales/snapshot";
import { runGraduationCheck } from "@/lib/billing/graduation";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * GET /api/cron/monthly-sales
 * Runs on the 1st (SAST), before the billing run: resolves last month's gross
 * sales for every active tenant, then checks for graduation candidates.
 * Both are idempotent and safe to re-run.
 */
export async function GET(request: Request) {
  const denied = authorizeCron(request);
  if (denied) return denied;

  try {
    const sales = await runMonthlySalesSnapshot();
    const graduation = await runGraduationCheck();
    return NextResponse.json({ ok: true, sales, graduation });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "monthly sales failed" },
      { status: 500 },
    );
  }
}
