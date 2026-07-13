import { TopBar } from "@/components/layout/top-bar";
import { isVatRegistered } from "@/lib/env";

export default function SettingsPage() {
  const vat = isVatRegistered();

  return (
    <>
      <TopBar title="Settings" />
      <main className="p-5">
        <section className="max-w-xl rounded-[4px] border border-border bg-surface p-4">
          <h2 className="mb-3 text-[13px] font-semibold">Billing policy</h2>
          <dl className="grid grid-cols-[140px_1fr] gap-y-2 text-[13px]">
            <dt className="text-muted">VAT registered</dt>
            <dd className="font-mono">{vat ? "true" : "false"}</dd>
            <dt className="text-muted">Invoice title</dt>
            <dd>{vat ? "Tax Invoice" : "Invoice"}</dd>
            <dt className="text-muted">Billing timing</dt>
            <dd>In advance, on the 1st, for the month ahead</dd>
            <dt className="text-muted">Mid-cycle changes</dt>
            <dd>No pro-rata — next cycle only</dd>
          </dl>
        </section>
      </main>
    </>
  );
}
