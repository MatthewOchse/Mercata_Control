import { connect as tlsConnect } from "node:tls";
import { decryptSecret } from "@/lib/crypto/secrets";
import type { FleetHealthPayload, PollResult } from "@/lib/health/types";

export type TenantProbeTarget = {
  id: number;
  slug: string;
  primaryDomain: string;
  healthPath: string;
  fleetSecretCipher: string;
};

function normaliseDomain(domain: string): string {
  return domain
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/$/, "");
}

export function healthUrl(domain: string, healthPath: string): string {
  const host = normaliseDomain(domain);
  const path = healthPath.startsWith("/") ? healthPath : `/${healthPath}`;
  return `https://${host}${path}`;
}

/** TLS days-to-expiry for the primary domain (independent of the fleet endpoint). */
export function probeTlsDaysRemaining(
  domain: string,
  timeoutMs = 8000,
): Promise<number | null> {
  const host = normaliseDomain(domain);
  return new Promise((resolve) => {
    const socket = tlsConnect(
      { host, port: 443, servername: host, rejectUnauthorized: false },
      () => {
        try {
          const cert = socket.getPeerCertificate();
          socket.end();
          if (!cert || !cert.valid_to) {
            resolve(null);
            return;
          }
          const expires = new Date(cert.valid_to).getTime();
          const days = Math.floor((expires - Date.now()) / (1000 * 60 * 60 * 24));
          resolve(days);
        } catch {
          resolve(null);
        }
      },
    );
    socket.setTimeout(timeoutMs, () => {
      socket.destroy();
      resolve(null);
    });
    socket.on("error", () => resolve(null));
  });
}

/** HTTPS reachability + timing of the primary domain origin. */
export async function probeHttps(
  domain: string,
  timeoutMs = 10000,
): Promise<{ ok: boolean; latencyMs: number | null; error: string | null }> {
  const host = normaliseDomain(domain);
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`https://${host}/`, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: { "user-agent": "MercataControl/health-probe" },
    });
    const latencyMs = Date.now() - started;
    return {
      ok: res.status > 0 && res.status < 500,
      latencyMs,
      error: res.status >= 500 ? `HTTP ${res.status}` : null,
    };
  } catch (err) {
    return {
      ok: false,
      latencyMs: Date.now() - started,
      error: err instanceof Error ? err.message : "HTTPS probe failed",
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function probeFleetHealth(
  target: TenantProbeTarget,
  timeoutMs = 10000,
): Promise<{
  ok: boolean;
  latencyMs: number | null;
  payload: FleetHealthPayload | null;
  error: string | null;
}> {
  const url = healthUrl(target.primaryDomain, target.healthPath);
  let secret: string;
  try {
    secret = decryptSecret(target.fleetSecretCipher);
  } catch (err) {
    return {
      ok: false,
      latencyMs: null,
      payload: null,
      error: err instanceof Error ? err.message : "fleet_secret decrypt failed",
    };
  }

  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "GET",
      signal: controller.signal,
      headers: {
        authorization: `Bearer ${secret}`,
        accept: "application/json",
        "user-agent": "MercataControl/fleet-health",
      },
      cache: "no-store",
    });
    const latencyMs = Date.now() - started;
    if (!res.ok) {
      return {
        ok: false,
        latencyMs,
        payload: null,
        error: `Fleet health HTTP ${res.status}`,
      };
    }
    const payload = (await res.json()) as FleetHealthPayload;
    const ok =
      payload.status === "ok" &&
      payload.db?.reachable !== false;
    return { ok, latencyMs, payload, error: ok ? null : "Fleet status not ok" };
  } catch (err) {
    return {
      ok: false,
      latencyMs: Date.now() - started,
      payload: null,
      error: err instanceof Error ? err.message : "Fleet probe failed",
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function pollTenant(
  target: TenantProbeTarget,
): Promise<PollResult> {
  const [https, tlsDays, fleet] = await Promise.all([
    probeHttps(target.primaryDomain),
    probeTlsDaysRemaining(target.primaryDomain),
    probeFleetHealth(target),
  ]);

  // Prefer fleet endpoint latency when available; else HTTPS probe.
  const latencyMs = fleet.latencyMs ?? https.latencyMs;
  const ok = https.ok && fleet.ok;
  const errorParts = [https.error, fleet.error].filter(Boolean);

  return {
    tenantId: target.id,
    slug: target.slug,
    ok,
    latencyMs,
    certDaysRemaining: tlsDays,
    httpsOk: https.ok,
    fleetOk: fleet.ok,
    payload: fleet.payload,
    error: errorParts.length ? errorParts.join("; ") : null,
  };
}
