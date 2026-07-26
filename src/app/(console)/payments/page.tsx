import Link from "next/link";
import { TopBar } from "@/components/layout/top-bar";
import {
  getStatementGapWarning,
  countUnmatchedCredits,
} from "@/lib/payments/reconcile";
import {
  listPayments,
  listTenantsForPaymentSelect,
} from "@/lib/payments/service";
import { PaymentsClient } from "./payments-client";

export default async function PaymentsPage() {
  const [payments, tenants, gap, unmatched] = await Promise.all([
    listPayments(),
    listTenantsForPaymentSelect(),
    getStatementGapWarning().catch(() => null),
    countUnmatchedCredits().catch(() => 0),
  ]);

  return (
    <>
      <TopBar title="Payments" />
      <main className="p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <p className="text-[13px] text-muted">
            {unmatched > 0 ? (
              <>
                <Link
                  href="/payments/reconcile"
                  className="font-semibold text-status-warn hover:underline"
                >
                  {unmatched} unmatched credit{unmatched === 1 ? "" : "s"}
                </Link>
                {" · "}
              </>
            ) : null}
            Manual EFT + FNB OFX reconcile
          </p>
          <Link
            href="/payments/reconcile"
            className="text-[13px] font-semibold text-accent-strong hover:underline"
          >
            Reconcile →
          </Link>
        </div>
        <PaymentsClient
          payments={payments}
          tenants={tenants}
          gap={gap}
        />
      </main>
    </>
  );
}
