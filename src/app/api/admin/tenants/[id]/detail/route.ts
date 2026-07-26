import { NextResponse } from "next/server";
import { getCurrentOperator } from "@/lib/auth/server";
import {
  DEFAULT_DETAIL_RANGE,
  getTenantTraffic,
  isDetailRange,
  TenantTrafficError,
  type DetailRange,
} from "@/lib/analytics/tenant-overview";
import { getCommerce } from "@/lib/tenants/commerce";
import { getTenantById, getTenantInfra } from "@/lib/tenants/queries";
import { getStanding } from "@/lib/tenants/standing";

export const dynamic = "force-dynamic";

function parseRange(raw: string | null): DetailRange {
  return isDetailRange(raw) ? raw : DEFAULT_DETAIL_RANGE;
}

function unwrapColumn<T>(
  settled: PromiseSettledResult<T>,
): { data: T | null; error: string | null; code?: string } {
  if (settled.status === "fulfilled") {
    return { data: settled.value, error: null };
  }
  const reason = settled.reason;
  if (reason instanceof TenantTrafficError) {
    return { data: null, error: reason.message, code: reason.code };
  }
  const message =
    reason instanceof Error
      ? reason.message
      : typeof reason === "string"
        ? reason
        : "error";
  const code =
    reason && typeof reason === "object" && "code" in reason
      ? String((reason as { code?: unknown }).code ?? "error")
      : "error";
  return { data: null, error: message, code };
}

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const operator = await getCurrentOperator();
  if (!operator) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { id: idRaw } = await context.params;
  const tenantId = Number.parseInt(idRaw, 10);
  if (!Number.isFinite(tenantId) || tenantId <= 0) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const tenant = await getTenantById(tenantId);
  if (!tenant) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const url = new URL(request.url);
  const range = parseRange(url.searchParams.get("range"));
  const infra = await getTenantInfra(tenant.id);

  const [analytics, standing, commerce] = await Promise.allSettled([
    getTenantTraffic({
      tenantId: tenant.id,
      propertyId: tenant.ga4_property_id,
      range,
    }),
    getStanding(tenant.id, tenant.billing_day),
    getCommerce({ tenantId: tenant.id, slug: tenant.slug, range }),
  ]);

  return NextResponse.json({
    tenant: {
      id: tenant.id,
      slug: tenant.slug,
      name: tenant.trading_name,
      domain: infra?.primary_domain ?? null,
      status: tenant.status,
      ga4PropertyId: tenant.ga4_property_id,
    },
    range,
    analytics: unwrapColumn(analytics),
    standing: unwrapColumn(standing),
    commerce: unwrapColumn(commerce),
  });
}
