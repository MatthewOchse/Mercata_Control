import Link from "next/link";
import { TopBar } from "@/components/layout/top-bar";
import { requireOperator } from "@/lib/auth/server";
import { listServerFillOptions } from "@/lib/servers/queries";
import { pickAutoTargetServer } from "@/lib/servers/assign";
import { ProvisionTenantForm } from "./provision-form";

export default async function NewTenantProvisionPage() {
  const operator = await requireOperator();
  if (!operator.is_super) {
    return (
      <>
        <TopBar title="New tenant" />
        <main className="p-5">
          <p className="text-[13px] text-status-error">
            Super-admin access required to provision tenants.
          </p>
        </main>
      </>
    );
  }

  const servers = await listServerFillOptions();
  const autoPick = pickAutoTargetServer(servers);

  return (
    <>
      <TopBar title="New tenant" />
      <main className="p-5">
        <p className="mb-4 max-w-2xl text-[13px] text-muted">
          Queues a host-scoped provision job. Internal secrets (AUTH /
          STORE_ADMIN / FLEET) are generated on the target host — not on this
          form. Billing-only prospects:{" "}
          <Link href="/tenants/prospect" className="text-accent-strong underline">
            New prospect
          </Link>
          .
        </p>
        <ProvisionTenantForm servers={servers} autoPickId={autoPick?.id ?? null} />
      </main>
    </>
  );
}
