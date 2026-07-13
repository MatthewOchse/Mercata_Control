import { TopBar } from "@/components/layout/top-bar";
import {
  listPayments,
  listTenantsForPaymentSelect,
} from "@/lib/payments/service";
import { PaymentsClient } from "./payments-client";

export default async function PaymentsPage() {
  const [payments, tenants] = await Promise.all([
    listPayments(),
    listTenantsForPaymentSelect(),
  ]);

  return (
    <>
      <TopBar title="Payments" />
      <main className="p-5">
        <PaymentsClient payments={payments} tenants={tenants} />
      </main>
    </>
  );
}
