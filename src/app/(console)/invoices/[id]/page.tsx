import { notFound } from "next/navigation";
import { TopBar } from "@/components/layout/top-bar";
import { isVatRegistered } from "@/lib/env";
import { getInvoiceById } from "@/lib/invoices/queries";
import { InvoiceDetailClient } from "./invoice-detail-client";

export default async function InvoiceDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const invoiceId = Number(id);
  if (!Number.isInteger(invoiceId)) notFound();
  const invoice = await getInvoiceById(invoiceId);
  if (!invoice) notFound();

  return (
    <>
      <TopBar
        title={invoice.invoice_number ?? `Draft #${invoice.id}`}
      />
      <main className="p-5">
        <InvoiceDetailClient
          invoice={invoice}
          vatRegistered={isVatRegistered()}
        />
      </main>
    </>
  );
}
