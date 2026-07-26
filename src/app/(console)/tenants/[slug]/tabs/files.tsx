import { BusinessFilesPanel } from "@/components/files/business-files-panel";
import { listBusinessFiles } from "@/lib/files/queries";
import { listTenants } from "@/lib/tenants/queries";

export async function FilesTab({
  tenantId,
  tenantSlug,
}: {
  tenantId: number;
  tenantSlug: string;
}) {
  const [files, tenants] = await Promise.all([
    listBusinessFiles({ tenantId }),
    listTenants(),
  ]);
  const tenantOptions = tenants.map((t) => ({
    id: t.id,
    slug: t.slug,
    trading_name: t.trading_name,
  }));

  return (
    <div className="space-y-3">
      <p className="text-[13px] text-muted">
        Files stored for this tenant. Mercata-wide admin files live on the{" "}
        <a href="/files?scope=mercata" className="text-accent-strong underline">
          Files
        </a>{" "}
        page.
      </p>
      <BusinessFilesPanel
        files={files}
        tenants={tenantOptions}
        lockedTenantId={tenantId}
        lockedTenantSlug={tenantSlug}
      />
    </div>
  );
}
