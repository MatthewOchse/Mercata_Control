import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { assertTenantRouteId } from "@/lib/caddy/ids";

function adminBaseUrl(): string {
  return (
    process.env.CADDY_ADMIN_URL?.trim() || "http://caddy:2019"
  ).replace(/\/$/, "");
}

export type CaddyRoute = {
  "@id"?: string;
  match?: Array<{ host?: string[]; path?: string[] }>;
  handle?: unknown[];
  terminal?: boolean;
  [key: string]: unknown;
};

export type CaddyConfig = {
  admin?: unknown;
  apps?: {
    http?: {
      servers?: Record<
        string,
        {
          listen?: string[];
          routes?: CaddyRoute[];
          [key: string]: unknown;
        }
      >;
    };
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

async function caddyFetch(
  method: string,
  apiPath: string,
  body?: unknown,
): Promise<Response> {
  if (apiPath === "/load" || apiPath.startsWith("/load?")) {
    throw new Error("Refusing POST /load — never replace the whole Caddy config from control");
  }
  const base = adminBaseUrl();
  const url = `${base}${apiPath}`;
  const headers: Record<string, string> = {
    // Caddy rejects empty Origin; Host-derived origin must also be allowlisted.
    Origin: base,
  };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch(url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });
  return res;
}

export async function getCaddyConfig(): Promise<CaddyConfig> {
  const res = await caddyFetch("GET", "/config/");
  if (!res.ok) {
    throw new Error(
      `Caddy GET /config/ failed: ${res.status} ${await res.text()}`,
    );
  }
  return (await res.json()) as CaddyConfig;
}

/** Snapshot full config before mutation. Returns absolute path written. */
export async function snapshotCaddyConfig(label: string): Promise<string> {
  const config = await getCaddyConfig();
  const dir = path.join(process.cwd(), "storage", "caddy-snapshots");
  await mkdir(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const safe = label.replace(/[^a-z0-9_-]+/gi, "_").slice(0, 64);
  const rel = path.join("storage", "caddy-snapshots", `${stamp}_${safe}.json`);
  const abs = path.join(process.cwd(), rel);
  await writeFile(abs, JSON.stringify(config, null, 2), "utf8");
  return abs;
}

export async function getRouteById(routeId: string): Promise<CaddyRoute> {
  assertTenantRouteId(routeId);
  const res = await caddyFetch("GET", `/id/${encodeURIComponent(routeId)}`);
  if (!res.ok) {
    throw new Error(
      `Caddy GET /id/${routeId} failed: ${res.status} ${await res.text()}`,
    );
  }
  return (await res.json()) as CaddyRoute;
}

/**
 * Targeted PATCH of a single named tenant route. Never touches admin_mercata
 * or global config.
 */
export async function patchTenantRoute(
  routeId: string,
  route: CaddyRoute,
): Promise<void> {
  assertTenantRouteId(routeId);
  if (route["@id"] && route["@id"] !== routeId) {
    throw new Error(
      `Route body @id ${JSON.stringify(route["@id"])} does not match ${routeId}`,
    );
  }
  const body = { ...route, "@id": routeId };
  const res = await caddyFetch(
    "PATCH",
    `/id/${encodeURIComponent(routeId)}`,
    body,
  );
  if (!res.ok) {
    throw new Error(
      `Caddy PATCH /id/${routeId} failed: ${res.status} ${await res.text()}`,
    );
  }
}

/** Locate a route in a snapshot by @id. */
export function findRouteInConfig(
  config: CaddyConfig,
  routeId: string,
): CaddyRoute | null {
  const servers = config.apps?.http?.servers ?? {};
  for (const srv of Object.values(servers)) {
    for (const route of srv.routes ?? []) {
      if (route["@id"] === routeId) return route;
    }
  }
  return null;
}

/**
 * Find a route by host match (used when assigning @id during bootstrap).
 * Prefer routes whose reverse_proxy dial mentions containerName.
 */
export function findRoutePathByHost(
  config: CaddyConfig,
  hosts: string[],
  containerName?: string | null,
): { serverKey: string; index: number; route: CaddyRoute } | null {
  const want = new Set(hosts.map((h) => h.toLowerCase()));
  const servers = config.apps?.http?.servers ?? {};
  let fallback: { serverKey: string; index: number; route: CaddyRoute } | null =
    null;

  for (const [serverKey, srv] of Object.entries(servers)) {
    const routes = srv.routes ?? [];
    for (let i = 0; i < routes.length; i++) {
      const route = routes[i]!;
      const matchedHosts =
        route.match?.flatMap((m) => m.host ?? []).map((h) => h.toLowerCase()) ??
        [];
      if (!matchedHosts.some((h) => want.has(h))) continue;
      const dial = JSON.stringify(route.handle ?? []);
      if (containerName && dial.includes(`${containerName}:`)) {
        return { serverKey, index: i, route };
      }
      fallback ??= { serverKey, index: i, route };
    }
  }
  return fallback;
}

/**
 * Assign @id on an existing route in place (index-based PATCH once).
 * Idempotent if already tagged.
 */
export async function ensureTenantRouteId(opts: {
  routeId: string;
  hosts: string[];
  containerName?: string | null;
}): Promise<void> {
  assertTenantRouteId(opts.routeId);
  try {
    await getRouteById(opts.routeId);
    return;
  } catch {
    // not tagged yet
  }

  const config = await getCaddyConfig();
  const found = findRoutePathByHost(
    config,
    opts.hosts,
    opts.containerName,
  );
  if (!found) {
    throw new Error(
      `No Caddy route found for hosts [${opts.hosts.join(", ")}] — cannot tag ${opts.routeId}`,
    );
  }
  if (found.route["@id"] && found.route["@id"] !== opts.routeId) {
    throw new Error(
      `Route already has @id ${found.route["@id"]}, expected ${opts.routeId}`,
    );
  }

  const tagged: CaddyRoute = { ...found.route, "@id": opts.routeId };
  const pathApi = `/config/apps/http/servers/${encodeURIComponent(found.serverKey)}/routes/${found.index}`;
  // Index path is allowed for one-time tagging of a known tenant route only.
  const res = await caddyFetch("PATCH", pathApi, tagged);
  if (!res.ok) {
    throw new Error(
      `Failed to tag route ${opts.routeId}: ${res.status} ${await res.text()}`,
    );
  }
}
