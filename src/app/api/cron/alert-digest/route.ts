import { NextResponse } from "next/server";
import { sendWarningDigest } from "@/lib/health/alerts";
import { authorizeCron } from "@/lib/health/cron-auth";

export const dynamic = "force-dynamic";

/** Cron: daily 08:00 SAST. Auth: Authorization: Bearer $CRON_SECRET */
export async function GET(request: Request) {
  const denied = authorizeCron(request);
  if (denied) return denied;

  try {
    const result = await sendWarningDigest();
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : "digest failed",
      },
      { status: 500 },
    );
  }
}
