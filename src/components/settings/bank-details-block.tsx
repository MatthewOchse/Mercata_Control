"use client";

import { useState } from "react";

export function BankDetailsBlock({ plainText }: { plainText: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(plainText);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback: select the textarea so the operator can Ctrl/Cmd+C
      const el = document.getElementById(
        "bank-details-copy",
      ) as HTMLTextAreaElement | null;
      el?.select();
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-[13px] font-semibold">Bank details</h2>
        <button
          type="button"
          onClick={copy}
          className="h-7 rounded-[4px] border border-border px-2.5 text-[12px] font-semibold hover:border-primary-light hover:bg-primary hover:text-white"
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <p className="text-[12px] text-muted">
        Used on invoices and invoice emails. Copy below for WhatsApp, quotes, or
        other messages.
      </p>
      <textarea
        id="bank-details-copy"
        readOnly
        rows={4}
        value={plainText}
        className="w-full resize-none rounded-[4px] border border-border bg-background px-3 py-2 font-mono text-[12px] leading-relaxed text-foreground"
        onFocus={(e) => e.currentTarget.select()}
      />
    </div>
  );
}
