import { NextResponse } from "next/server";
import { getPool } from "@/lib/db/pool";

export const dynamic = "force-dynamic";

/** Liveness for Docker healthchecks — DB ping. */
export async function GET() {
  try {
    const pool = getPool();
    await pool.query("SELECT 1 AS ok");
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : "db_unreachable",
      },
      { status: 503 },
    );
  }
}
