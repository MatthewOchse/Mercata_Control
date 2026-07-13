import { TopBar } from "@/components/layout/top-bar";
import { CreateTenantForm } from "./create-form";
import { listPlans } from "@/lib/tenants/queries";

export default async function NewTenantPage() {
  const plans = await listPlans();

  return (
    <>
      <TopBar title="New tenant" />
      <main className="p-5">
        <CreateTenantForm plans={plans} />
      </main>
    </>
  );
}
