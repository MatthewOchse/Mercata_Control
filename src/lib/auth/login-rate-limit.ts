/** Soft in-memory IP rate limit for /login (Edge-safe — no DB). */

export const LOGIN_RATE_LIMIT_PER_MINUTE = 10;

const ipBuckets = new Map<string, { count: number; windowStart: number }>();

export function checkLoginIpRateLimit(ip: string): {
  allowed: boolean;
  retryAfterSeconds?: number;
} {
  const now = Date.now();
  const windowMs = 60_000;
  const key = ip || "unknown";
  let bucket = ipBuckets.get(key);
  if (!bucket || now - bucket.windowStart >= windowMs) {
    bucket = { count: 0, windowStart: now };
    ipBuckets.set(key, bucket);
  }
  bucket.count += 1;
  if (bucket.count > LOGIN_RATE_LIMIT_PER_MINUTE) {
    const retryAfterSeconds = Math.ceil(
      (bucket.windowStart + windowMs - now) / 1000,
    );
    return { allowed: false, retryAfterSeconds: Math.max(1, retryAfterSeconds) };
  }
  return { allowed: true };
}
