import { TopBar } from "@/components/layout/top-bar";
import { comingBillingPeriod, periodLabel } from "@/lib/invoices/period";
import { previewBillingRun } from "@/lib/invoices/queries";
import {
  previousSastMonth,
  sastMonthFromIso,
  sastMonthWindow,
} from "@/lib/sales/period";
import { BillingRunClient } from "./billing-run-client";

export default async function BillingRunPage() {
  const { periodStart, periodEnd } = comingBillingPeriod();
  const rows = await previewBillingRun(periodStart, periodEnd);

  // Commission is charged on the month that just closed, not the month billed.
  const salesMonth = previousSastMonth(sastMonthFromIso(periodStart));
  const salesWindow = sastMonthWindow(salesMonth.year, salesMonth.month);

  return (
    <>
      <TopBar title="Billing run" />
      <main className="p-5">
        <BillingRunClient
          periodStart={periodStart}
          periodEnd={periodEnd}
          periodLabel={periodLabel(periodStart)}
          salesLabel={salesWindow.label}
          rows={rows}
        />
      </main>
    </>
  );
}
