import { connect as tlsConnect } from "node:tls";
import { decryptSecret } from "@/lib/crypto/secrets";
import { fetchFleetAuthorized } from "@/lib/health/fleet-fetch";
import {
  planExpectsFleetHealth,
  type FleetHealthPayload,
  type PollResult,
} from "@/lib/health/types";

export type TenantProbeTarget = {
  id: number;
  slug: string;
  primaryDomain: string;
  healthPath: string;
  fleetSecretCipher: string;
  /** Active subscription plan code, if any. */
  planCode: string | null;
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
  try {
    const res = await fetchFleetAuthorized(url, secret, {
      timeoutMs,
      userAgent: "MercataControl/fleet-health",
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
    // Endpoint reachable + JSON OK. Soft issues (degraded / pending migrations)
    // are separate signals — not site_down.
    return { ok: true, latencyMs, payload, error: null };
  } catch (err) {
    return {
      ok: false,
      latencyMs: Date.now() - started,
      payload: null,
      error: err instanceof Error ? err.message : "Fleet probe failed",
    };
  }
}

export async function pollTenant(
  target: TenantProbeTarget,
): Promise<PollResult> {
  // Sites (service_hosting) are marketing/brochure deploys — they have no
  // fleet secret endpoint. Probing /api/_fleet/health there always 404s and
  // falsely raises site_down. For those, origin HTTPS is the health check.
  const expectsFleet = planExpectsFleetHealth(target.planCode);

  const [https, tlsDays, fleet] = await Promise.all([
    probeHttps(target.primaryDomain),
    probeTlsDaysRemaining(target.primaryDomain),
    expectsFleet
      ? probeFleetHealth(target)
      : Promise.resolve({
          ok: true,
          latencyMs: null as number | null,
          payload: null as FleetHealthPayload | null,
          error: null as string | null,
        }),
  ]);

  const latencyMs = fleet.latencyMs ?? https.latencyMs;
  const ok = https.ok && fleet.ok;
  const errorParts = [https.error, fleet.error].filter(Boolean);

  return {
    tenantId: target.id,
    slug: target.slug,
    planCode: target.planCode,
    ok,
    latencyMs,
    certDaysRemaining: tlsDays,
    httpsOk: https.ok,
    fleetOk: fleet.ok,
    payload: fleet.payload,
    error: errorParts.length ? errorParts.join("; ") : null,
  };
}
