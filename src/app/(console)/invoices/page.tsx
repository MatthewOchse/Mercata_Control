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
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <p className="text-[13px] text-muted">
            Issued invoices are immutable. Corrections via credit note.
          </p>
          <div className="flex flex-wrap gap-2">
            <Link
              href="/invoices/new"
              className="h-8 rounded-[4px] border border-border px-3 text-[13px] font-semibold leading-8 hover:border-primary-light hover:bg-primary hover:text-white"
            >
              New custom invoice
            </Link>
            <Link
              href="/billing/run"
              className="h-8 rounded-[4px] bg-accent-strong px-3 text-[13px] font-semibold leading-8 text-white hover:bg-primary"
            >
              Billing run
            </Link>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Number</th>
                <th>Tenant</th>
                <th>Status</th>
                <th>Period</th>
                <th>Due</th>
                <th className="text-right">Total</th>
                <th>PDF</th>
              </tr>
            </thead>
            <tbody>
              {invoices.length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-muted">
                    No invoices. Start a{" "}
                    <Link
                      href="/billing/run"
                      className="text-accent-strong underline"
                    >
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
                      {inv.source === "manual" ? (
                        <div className="text-[10px] text-muted uppercase">
                          Custom
                        </div>
                      ) : null}
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
                    <td>
                      {inv.has_pdf ? (
                        <a
                          href={`/invoices/${inv.id}/pdf`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[12px] font-semibold text-accent-strong hover:underline"
                        >
                          View
                        </a>
                      ) : (
                        <span className="text-[12px] text-muted">—</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </main>
    </>
  );
}
