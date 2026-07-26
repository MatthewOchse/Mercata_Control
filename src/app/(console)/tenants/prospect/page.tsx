import { TopBar } from "@/components/layout/top-bar";
import { CreateTenantForm } from "./create-form";
import { listPlans } from "@/lib/tenants/queries";
import { requireOperator } from "@/lib/auth/server";
import Link from "next/link";

/** Billing CRM prospect (no fleet provision). */
export default async function NewProspectPage() {
  const operator = await requireOperator();
  if (!operator.is_super) {
    return (
      <>
        <TopBar title="New prospect" />
        <main className="p-5">
          <p className="text-[13px] text-status-error">
            Super-admin access required.
          </p>
        </main>
      </>
    );
  }

  const plans = await listPlans();

  return (
    <>
      <TopBar title="New prospect" />
      <main className="p-5">
        <p className="mb-4 text-[13px] text-muted">
          Creates a billing prospect only. To provision a live storefront, use{" "}
          <Link href="/tenants/new" className="text-accent-strong underline">
            New tenant
          </Link>
          .
        </p>
        <CreateTenantForm plans={plans} />
      </main>
    </>
  );
}
