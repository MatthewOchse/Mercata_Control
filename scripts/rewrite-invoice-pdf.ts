#!/usr/bin/env tsx
/**
 * Rewrite PDF (+ optional resend) for an issued invoice after a template change.
 * Usage: INVOICE_ID=1 [RESEND=1] npx tsx scripts/rewrite-invoice-pdf.ts
 */
import "dotenv/config";
import {
  rewriteIssuedInvoicePdf,
} from "../src/lib/invoices/issue";
import { sendInvoiceEmail } from "../src/lib/invoices/delivery";

async function main() {
  const id = Number(process.env.INVOICE_ID);
  if (!Number.isInteger(id) || id < 1) {
    console.error("Set INVOICE_ID to a positive integer");
    process.exit(1);
  }
  const actor = process.env.ACTOR?.trim() || "operator:template-rewrite";
  const result = await rewriteIssuedInvoicePdf(id, actor);
  console.log(`Rewrote PDF → ${result.pdfPath}`);

  if (process.env.RESEND === "1") {
    const sent = await sendInvoiceEmail(id, actor);
    if (sent.sent) console.log(`Resent email at ${sent.sentAt}`);
    else console.error(`Resend failed: ${sent.error}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
