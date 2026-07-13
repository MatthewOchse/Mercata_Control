import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

export function authorizeCron(request: Request): NextResponse | null {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    return NextResponse.json(
      { error: "CRON_SECRET not configured" },
      { status: 503 },
    );
  }

  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  const a = Buffer.from(token);
  const b = Buffer.from(secret);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    // Invisible to probes — same posture as fleet endpoints
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return null;
}
