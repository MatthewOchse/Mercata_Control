import { createHmac, timingSafeEqual } from "node:crypto";
import type { RowDataPacket } from "mysql2/promise";
import { query } from "@/lib/db/pool";

function unsubSecret(): string {
  return (
    process.env.DIGEST_UNSUB_SECRET?.trim() ||
    process.env.SESSION_SECRET?.trim() ||
    ""
  );
}

function appOrigin(): string {
  return (process.env.APP_URL?.trim() || "http://localhost:3000").replace(
    /\/$/,
    "",
  );
}

/** Signed unsubscribe token: tenantId:email:exp:sig */
export function createUnsubscribeToken(
  tenantId: number,
  email: string,
  ttlDays = 365,
): string {
  const secret = unsubSecret();
  if (!secret) throw new Error("DIGEST_UNSUB_SECRET or SESSION_SECRET required");
  const exp = Math.floor(Date.now() / 1000) + ttlDays * 86400;
  const payload = `${tenantId}:${email.toLowerCase()}:${exp}`;
  const sig = createHmac("sha256", secret).update(payload).digest("base64url");
  return Buffer.from(`${payload}:${sig}`).toString("base64url");
}

export function unsubscribeUrl(tenantId: number, email: string): string {
  const token = createUnsubscribeToken(tenantId, email);
  return `${appOrigin()}/api/digest/unsubscribe?token=${encodeURIComponent(token)}`;
}

export type UnsubResult =
  | { ok: true; tradingName: string }
  | { ok: false; error: string };

export async function processUnsubscribe(
  tokenRaw: string,
): Promise<UnsubResult> {
  const secret = unsubSecret();
  if (!secret) return { ok: false, error: "Server misconfigured" };

  let decoded: string;
  try {
    decoded = Buffer.from(tokenRaw, "base64url").toString("utf8");
  } catch {
    return { ok: false, error: "Invalid link" };
  }

  const parts = decoded.split(":");
  if (parts.length !== 4) return { ok: false, error: "Invalid link" };
  const [tenantIdStr, email, expStr, sig] = parts;
  const tenantId = Number(tenantIdStr);
  const exp = Number(expStr);
  if (!Number.isFinite(tenantId) || !email || !Number.isFinite(exp) || !sig) {
    return { ok: false, error: "Invalid link" };
  }
  if (exp < Math.floor(Date.now() / 1000)) {
    return { ok: false, error: "This link has expired" };
  }

  const payload = `${tenantId}:${email}:${exp}`;
  const expected = createHmac("sha256", secret)
    .update(payload)
    .digest("base64url");
  try {
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      return { ok: false, error: "Invalid link" };
    }
  } catch {
    return { ok: false, error: "Invalid link" };
  }

  const rows = await query<(RowDataPacket & { trading_name: string })[]>(
    `SELECT trading_name FROM tenants WHERE id = :id LIMIT 1`,
    { id: tenantId },
  );
  if (!rows[0]) return { ok: false, error: "Unknown tenant" };

  await query(
    `UPDATE tenants SET digest_cadence = 'off' WHERE id = :id`,
    { id: tenantId },
  );

  return { ok: true, tradingName: rows[0].trading_name };
}
