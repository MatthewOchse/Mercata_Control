import { TopBar } from "@/components/layout/top-bar";
import {
  BusinessFilesFilters,
  BusinessFilesPanel,
} from "@/components/files/business-files-panel";
import { listBusinessFiles } from "@/lib/files/queries";
import { listTenants } from "@/lib/tenants/queries";

export default async function FilesPage({
  searchParams,
}: {
  searchParams: Promise<{
    scope?: string;
    tenant_id?: string;
    category?: string;
  }>;
}) {
  const sp = await searchParams;
  const scope =
    sp.scope === "mercata" || sp.scope === "tenant" ? sp.scope : "all";
  const tenantId = sp.tenant_id ? Number(sp.tenant_id) : undefined;
  const category = sp.category?.trim() || undefined;

  const tenants = await listTenants();
  const tenantOptions = tenants.map((t) => ({
    id: t.id,
    slug: t.slug,
    trading_name: t.trading_name,
  }));

  const listOpts =
    scope === "mercata"
      ? { tenantId: null as null, category }
      : scope === "tenant" && tenantId
        ? { tenantId, category }
        : { category };

  const files = await listBusinessFiles(listOpts);

  return (
    <>
      <TopBar title="Files" />
      <main className="p-5">
        <p className="mb-4 text-[13px] text-muted">
          Secure vault for Mercata-wide and tenant-specific documents — contracts,
          onboarding packs, finance exports, and other business files.
        </p>
        <BusinessFilesFilters
          scope={scope}
          tenantId={tenantId}
          category={category}
          tenants={tenantOptions}
        />
        <div className="mt-4">
          <BusinessFilesPanel files={files} tenants={tenantOptions} />
        </div>
      </main>
    </>
  );
}
