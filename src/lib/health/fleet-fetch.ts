/**
 * Fetch a fleet endpoint, following redirects while keeping Authorization.
 * Browsers/undici strip auth on cross-host redirects (e.g. apex → www),
 * which makes /api/_fleet/* look like a 404 “wrong secret”.
 */
export async function fetchFleetAuthorized(
  url: string,
  secret: string,
  opts?: {
    timeoutMs?: number;
    signal?: AbortSignal;
    userAgent?: string;
  },
): Promise<Response> {
  const timeoutMs = opts?.timeoutMs ?? 10000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onAbort = () => controller.abort();
  opts?.signal?.addEventListener("abort", onAbort);

  try {
    let current = url;
    for (let hop = 0; hop < 5; hop++) {
      const res = await fetch(current, {
        method: "GET",
        redirect: "manual",
        signal: controller.signal,
        headers: {
          authorization: `Bearer ${secret}`,
          accept: "application/json",
          "user-agent": opts?.userAgent ?? "MercataControl/fleet",
        },
        cache: "no-store",
      });

      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get("location");
        if (!loc) {
          return res;
        }
        current = new URL(loc, current).toString();
        continue;
      }

      return res;
    }
    throw new Error("Fleet request: too many redirects");
  } finally {
    clearTimeout(timer);
    opts?.signal?.removeEventListener("abort", onAbort);
  }
}
