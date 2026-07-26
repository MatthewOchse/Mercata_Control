import { TopBar } from "@/components/layout/top-bar";
import { listPlans } from "@/lib/plans/queries";
import { PlansClient } from "./plans-client";

export default async function PlansPage() {
  const plans = await listPlans();

  return (
    <>
      <TopBar title="Plans" />
      <main className="p-5">
        <PlansClient plans={plans} />
      </main>
    </>
  );
}
