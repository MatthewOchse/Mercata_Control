#!/usr/bin/env tsx
/**
 * One-shot: open Caddy admin + tag tenant routes with @id tenant_{slug}.
 * Safe to re-run. Never POSTs /load.
 *
 * Usage (on caddy_net / with CADDY_ADMIN_URL):
 *   npx tsx scripts/caddy-tag-tenant-routes.ts
 */
import "dotenv/config";
import {
  ensureTenantRouteId,
  getCaddyConfig,
  type CaddyRoute,
} from "../src/lib/caddy/client";
import { tenantRouteId } from "../src/lib/caddy/ids";

const TAGS: Array<{
  slug: string;
  hosts: string[];
  container: string;
}> = [
  {
    slug: "crafties",
    hosts: ["www.crafties.co.za", "crafties.co.za", "crafties.localhost"],
    container: "crafties",
  },
  {
    slug: "geist",
    hosts: ["geist.localhost"],
    container: "geist",
  },
];

async function tagAdminMercata(): Promise<void> {
  const config = await getCaddyConfig();
  const servers = config.apps?.http?.servers ?? {};
  for (const [serverKey, srv] of Object.entries(servers)) {
    const routes = srv.routes ?? [];
    for (let i = 0; i < routes.length; i++) {
      const route = routes[i] as CaddyRoute;
      const hosts =
        route.match?.flatMap((m) => m.host ?? []).map((h) => h.toLowerCase()) ??
        [];
      if (!hosts.includes("admin.mercata.co.za")) continue;
      if (route["@id"] === "admin_mercata") {
        console.log("admin_mercata already tagged");
        return;
      }
      const tagged = { ...route, "@id": "admin_mercata" };
      const url = `${(process.env.CADDY_ADMIN_URL || "http://caddy:2019").replace(/\/$/, "")}/config/apps/http/servers/${encodeURIComponent(serverKey)}/routes/${i}`;
      const res = await fetch(url, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(tagged),
      });
      if (!res.ok) {
        throw new Error(`tag admin_mercata failed: ${res.status} ${await res.text()}`);
      }
      console.log("Tagged admin_mercata");
      return;
    }
  }
  console.warn("admin.mercata.co.za route not found");
}

async function main() {
  console.log("Caddy config reachable — tagging routes…");
  await tagAdminMercata();
  for (const t of TAGS) {
    const id = tenantRouteId(t.slug);
    await ensureTenantRouteId({
      routeId: id,
      hosts: t.hosts,
      containerName: t.container,
    });
    console.log(`OK ${id}`);
  }
  console.log("Done");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
