import {
  ensureTenantRouteId,
  findRouteInConfig,
  getCaddyConfig,
  getRouteById,
  patchTenantRoute,
  snapshotCaddyConfig,
  type CaddyRoute,
} from "@/lib/caddy/client";
import {
  HOLDING_PAGE_MARKER,
  renderSuspensionHoldingPage,
} from "@/lib/caddy/holding-page";
import { tenantRouteId } from "@/lib/caddy/ids";

export type SuspendCaddyInput = {
  slug: string;
  tradingName: string;
  /** Hosts that must serve the holding page (usually primary + www). */
  hosts: string[];
  containerName: string | null;
  /** Back-office paths still proxied to the container. */
  adminPaths: string[];
};

function dialUpstream(containerName: string | null): string {
  const name = (containerName ?? "").trim() || "unknown";
  return `${name}:3000`;
}

function extractUpstreamDial(route: CaddyRoute): string | null {
  const raw = JSON.stringify(route.handle ?? []);
  const m = raw.match(/"dial"\s*:\s*"([^"]+:3000)"/);
  return m?.[1] ?? null;
}

function reverseProxyHandle(dial: string): unknown {
  return {
    handler: "reverse_proxy",
    upstreams: [{ dial }],
  };
}

export function buildSuspendedRoute(
  previous: CaddyRoute,
  opts: {
    tradingName: string;
    adminPaths: string[];
    dial: string;
  },
): CaddyRoute {
  const html = renderSuspensionHoldingPage(opts.tradingName);
  return {
    ...previous,
    handle: [
      {
        handler: "subroute",
        routes: [
          {
            match: [{ path: opts.adminPaths }],
            handle: [reverseProxyHandle(opts.dial)],
          },
          {
            handle: [
              {
                handler: "static_response",
                status_code: 503,
                headers: {
                  "Content-Type": ["text/html; charset=utf-8"],
                  "Cache-Control": ["no-store"],
                },
                body: html,
              },
            ],
          },
        ],
      },
    ],
    terminal: true,
  };
}

/** Restore a plain reverse_proxy subroute (unsuspend). */
export function buildActiveRoute(
  previous: CaddyRoute,
  dial: string,
): CaddyRoute {
  return {
    ...previous,
    handle: [
      {
        handler: "subroute",
        routes: [
          {
            handle: [reverseProxyHandle(dial)],
          },
        ],
      },
    ],
    terminal: true,
  };
}

export function isRouteSuspended(route: CaddyRoute): boolean {
  return JSON.stringify(route.handle ?? []).includes(HOLDING_PAGE_MARKER);
}

async function verifyHoldingPage(url: string, expectSuspended: boolean) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const res = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: { Accept: "text/html", "User-Agent": "mercata-control-suspend-verify/1" },
      cache: "no-store",
    });
    const body = await res.text();
    const hasMarker = body.includes(HOLDING_PAGE_MARKER);
    if (expectSuspended) {
      if (!hasMarker) {
        throw new Error(
          `Verification failed: ${url} did not serve the holding page (HTTP ${res.status})`,
        );
      }
    } else if (hasMarker) {
      throw new Error(
        `Verification failed: ${url} still serves the holding page after unsuspend`,
      );
    }
  } finally {
    clearTimeout(timer);
  }
}

function primaryVerifyUrl(hosts: string[]): string {
  const host =
    hosts.find((h) => h.startsWith("www.")) ??
    hosts.find((h) => !h.includes("localhost")) ??
    hosts[0];
  if (!host) throw new Error("No host available to verify suspension");
  if (host.includes("localhost") || host.endsWith(".local")) {
    return `http://${host}/`;
  }
  return `https://${host}/`;
}

export async function enforceCaddySuspend(
  input: SuspendCaddyInput,
): Promise<{ snapshotPath: string; routeId: string }> {
  const routeId = tenantRouteId(input.slug);
  const adminPaths =
    input.adminPaths.length > 0
      ? input.adminPaths
      : ["/admin*", "/api/admin*"];

  const snapshotPath = await snapshotCaddyConfig(`suspend_${input.slug}`);
  await ensureTenantRouteId({
    routeId,
    hosts: input.hosts,
    containerName: input.containerName,
  });

  const before = await getRouteById(routeId);
  const dial =
    extractUpstreamDial(before) ?? dialUpstream(input.containerName);
  const next = buildSuspendedRoute(before, {
    tradingName: input.tradingName,
    adminPaths,
    dial,
  });

  try {
    await patchTenantRoute(routeId, next);
    await verifyHoldingPage(primaryVerifyUrl(input.hosts), true);
  } catch (err) {
    await rollbackRoute(routeId, snapshotPath, before);
    throw err instanceof Error
      ? err
      : new Error("Suspension enforcement failed");
  }

  return { snapshotPath, routeId };
}

export async function enforceCaddyUnsuspend(
  input: SuspendCaddyInput,
): Promise<{ snapshotPath: string; routeId: string }> {
  const routeId = tenantRouteId(input.slug);
  const snapshotPath = await snapshotCaddyConfig(`unsuspend_${input.slug}`);
  await ensureTenantRouteId({
    routeId,
    hosts: input.hosts,
    containerName: input.containerName,
  });

  const before = await getRouteById(routeId);
  const dial =
    extractUpstreamDial(before) ?? dialUpstream(input.containerName);
  // Prefer restoring reverse_proxy only (drop holding handler).
  const next = buildActiveRoute(before, dial);

  try {
    await patchTenantRoute(routeId, next);
    await verifyHoldingPage(primaryVerifyUrl(input.hosts), false);
  } catch (err) {
    await rollbackRoute(routeId, snapshotPath, before);
    throw err instanceof Error
      ? err
      : new Error("Unsuspend enforcement failed");
  }

  return { snapshotPath, routeId };
}

async function rollbackRoute(
  routeId: string,
  snapshotPath: string,
  fallback: CaddyRoute,
): Promise<void> {
  try {
    const snap = JSON.parse(
      await (await import("node:fs/promises")).readFile(snapshotPath, "utf8"),
    ) as Awaited<ReturnType<typeof getCaddyConfig>>;
    const fromSnap = findRouteInConfig(snap, routeId) ?? fallback;
    await patchTenantRoute(routeId, fromSnap);
  } catch (rollbackErr) {
    console.error(
      `[caddy] rollback failed for ${routeId}:`,
      rollbackErr instanceof Error ? rollbackErr.message : rollbackErr,
    );
    try {
      await patchTenantRoute(routeId, fallback);
    } catch (e2) {
      console.error(
        `[caddy] fallback rollback failed for ${routeId}:`,
        e2 instanceof Error ? e2.message : e2,
      );
    }
  }
}

/** Host candidates used to locate / verify a tenant storefront. */
export function storefrontHosts(
  primaryDomain: string,
  extraDomains: string[] = [],
): string[] {
  const hosts = new Set<string>();
  const primary = primaryDomain.trim().toLowerCase();
  if (primary) {
    hosts.add(primary);
    if (!primary.startsWith("www.") && !primary.includes("localhost")) {
      hosts.add(`www.${primary}`);
    }
    if (primary.startsWith("www.")) {
      hosts.add(primary.slice(4));
    }
  }
  for (const d of extraDomains) {
    const x = d.trim().toLowerCase();
    if (x) hosts.add(x);
  }
  return [...hosts];
}
