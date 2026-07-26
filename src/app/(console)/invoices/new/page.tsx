import Link from "next/link";
import { TopBar } from "@/components/layout/top-bar";
import { firstDayOfThisMonth } from "@/lib/billing/cycle";
import { listTenants } from "@/lib/tenants/queries";
import { NewInvoiceClient } from "./new-invoice-client";

export default async function NewInvoicePage({
  searchParams,
}: {
  searchParams: Promise<{ tenant?: string }>;
}) {
  const sp = await searchParams;
  const tenants = await listTenants();
  const billable = tenants.filter(
    (t) => t.status === "active" || t.status === "suspended",
  );
  const defaultMonth = firstDayOfThisMonth().slice(0, 7);
  const preselect = billable.find((t) => t.slug === sp.tenant);

  return (
    <>
      <TopBar title="New custom invoice" />
      <main className="p-5">
        <div className="mb-4 flex items-center justify-between">
          <p className="text-[13px] text-muted">
            Manual draft for a calendar month. Lines are locked from auto-rebuild.
          </p>
          <Link href="/invoices" className="text-[13px] text-muted hover:text-foreground">
            ← Invoices
          </Link>
        </div>
        <NewInvoiceClient
          tenants={billable.map((t) => ({
            id: t.id,
            slug: t.slug,
            tradingName: t.trading_name,
          }))}
          defaultTenantId={preselect?.id ?? billable[0]?.id ?? null}
          defaultMonth={defaultMonth}
        />
      </main>
    </>
  );
}
