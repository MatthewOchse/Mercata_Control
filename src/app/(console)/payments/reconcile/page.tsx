import Link from "next/link";
import { TopBar } from "@/components/layout/top-bar";
import {
  getStatementGapWarning,
  listOpenInvoicesForReconcile,
  listUnmatchedCredits,
} from "@/lib/payments/reconcile";
import { ReconcileClient } from "./reconcile-client";

export default async function ReconcilePage() {
  const [credits, invoices, gap] = await Promise.all([
    listUnmatchedCredits(),
    listOpenInvoicesForReconcile(),
    getStatementGapWarning(),
  ]);

  return (
    <>
      <TopBar title="Reconcile statements" />
      <main className="p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <p className="text-[13px] text-muted">
            Propose matches only — confirm to create a payment. Never auto-writes
            payments.
          </p>
          <Link
            href="/payments"
            className="text-[13px] text-muted hover:text-foreground"
          >
            ← Payments
          </Link>
        </div>
        <ReconcileClient credits={credits} invoices={invoices} gap={gap} />
      </main>
    </>
  );
}
