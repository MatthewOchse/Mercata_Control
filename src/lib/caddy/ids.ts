const TENANT_ROUTE_ID = /^tenant_[a-z0-9-]+$/;

/** Stable Caddy @id for a tenant storefront route. */
export function tenantRouteId(slug: string): string {
  const normalised = slug.trim().toLowerCase();
  const id = `tenant_${normalised}`;
  assertTenantRouteId(id);
  return id;
}

export function assertTenantRouteId(id: string): void {
  if (!TENANT_ROUTE_ID.test(id)) {
    throw new Error(
      `Refusing Caddy mutation: route id ${JSON.stringify(id)} is not a tenant_* route`,
    );
  }
  if (id === "admin_mercata" || id.startsWith("admin_")) {
    throw new Error("Refusing Caddy mutation: admin routes are off-limits");
  }
}

export function isTenantRouteId(id: string): boolean {
  return TENANT_ROUTE_ID.test(id);
}
