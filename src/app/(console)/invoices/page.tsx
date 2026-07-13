import Link from "next/link";
import { TopBar } from "@/components/layout/top-bar";
import { Money, StatusPill } from "@/components/ui/status";
import { formatIsoDate } from "@/lib/billing/cycle";
import { listInvoices } from "@/lib/invoices/queries";
import {
  invoiceStatusLabel,
  invoiceStatusTone,
} from "@/lib/tenants/status";

export default async function InvoicesPage() {
  const invoices = await listInvoices();

  return (
    <>
      <TopBar title="Invoices" />
      <main className="p-5">
        <div className="mb-3 flex items-center justify-between">
          <p className="text-[13px] text-muted">
            Issued invoices are immutable. Corrections via credit note.
          </p>
          <Link
            href="/billing/run"
            className="h-8 rounded-[4px] bg-accent-strong px-3 text-[13px] font-semibold leading-8 text-white"
          >
            Billing run
          </Link>
        </div>
        <table className="admin-table">
          <thead>
            <tr>
              <th>Number</th>
              <th>Tenant</th>
              <th>Status</th>
              <th>Period</th>
              <th>Due</th>
              <th className="text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {invoices.length === 0 ? (
              <tr>
                <td colSpan={6} className="text-muted">
                  No invoices. Start a{" "}
                  <Link href="/billing/run" className="text-accent-strong underline">
                    billing run
                  </Link>
                  .
                </td>
              </tr>
            ) : (
              invoices.map((inv) => (
                <tr
                  key={inv.id}
                  className={inv.unsent ? "bg-status-error/8" : undefined}
                >
                  <td>
                    <Link
                      href={`/invoices/${inv.id}`}
                      className="font-mono text-[12px] text-accent-strong hover:underline"
                    >
                      {inv.invoice_number ?? `draft #${inv.id}`}
                    </Link>
                    {inv.unsent ? (
                      <div className="text-[10px] font-semibold text-status-error uppercase">
                        Unsent
                      </div>
                    ) : null}
                  </td>
                  <td>
                    <Link
                      href={`/tenants/${inv.slug}`}
                      className="hover:text-accent-strong"
                    >
                      {inv.trading_name}
                    </Link>
                  </td>
                  <td>
                    <StatusPill
                      tone={invoiceStatusTone(inv.status)}
                      label={invoiceStatusLabel(inv.status)}
                    />
                  </td>
                  <td className="font-mono text-[11px]">
                    {formatIsoDate(inv.period_start)} →{" "}
                    {formatIsoDate(inv.period_end)}
                  </td>
                  <td className="font-mono text-[12px]">
                    {formatIsoDate(inv.due_date)}
                  </td>
                  <td className="text-right">
                    <Money cents={inv.total_cents} />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </main>
    </>
  );
}
