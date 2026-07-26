import { TopBar } from "@/components/layout/top-bar";
import { BankDetailsBlock } from "@/components/settings/bank-details-block";
import { isVatRegistered } from "@/lib/env";
import {
  formatBankDetailsPlain,
  getBankingDetails,
} from "@/lib/invoices/company";

export default function SettingsPage() {
  const vat = isVatRegistered();
  const bank = getBankingDetails();
  const plain = formatBankDetailsPlain();

  return (
    <>
      <TopBar title="Settings" />
      <main className="space-y-4 p-5">
        <section className="max-w-xl rounded-[4px] border border-border bg-surface p-4">
          <BankDetailsBlock plainText={plain} />
          <dl className="mt-4 grid grid-cols-[140px_1fr] gap-y-2 border-t border-border pt-3 text-[13px]">
            <dt className="text-muted">Bank</dt>
            <dd>{bank.bankName}</dd>
            <dt className="text-muted">Account holder</dt>
            <dd>{bank.accountName}</dd>
            <dt className="text-muted">Account number</dt>
            <dd className="font-mono text-[12px]">{bank.accountNumber}</dd>
            <dt className="text-muted">Branch code</dt>
            <dd className="font-mono text-[12px]">{bank.branchCode}</dd>
          </dl>
        </section>

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
