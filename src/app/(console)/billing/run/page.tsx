import { TopBar } from "@/components/layout/top-bar";
import { comingBillingPeriod, periodLabel } from "@/lib/invoices/period";
import { previewBillingRun } from "@/lib/invoices/queries";
import { BillingRunClient } from "./billing-run-client";

export default async function BillingRunPage() {
  const { periodStart, periodEnd } = comingBillingPeriod();
  const rows = await previewBillingRun(periodStart, periodEnd);

  return (
    <>
      <TopBar title="Billing run" />
      <main className="p-5">
        <BillingRunClient
          periodStart={periodStart}
          periodEnd={periodEnd}
          periodLabel={periodLabel(periodStart)}
          rows={rows}
        />
      </main>
    </>
  );
}
