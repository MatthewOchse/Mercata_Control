import {
  getBankingDetails,
  getMercataLegalName,
} from "@/lib/invoices/company";
import { emailTokens, esc } from "@/lib/digest/email-tokens";
import { formatZAR } from "@/lib/money";

const NAVY = "#1A2B4A";
const GOLD = "#E0A82E";
const GOLD_STRONG = "#946F09";

export type InvoiceEmailInput = {
  recipientName: string;
  tradingName: string;
  invoiceNumber: string;
  totalCents: number;
  dueDate: string | null;
  issueDate: string | null;
  periodStart?: string | null;
  periodEnd?: string | null;
};

export function renderInvoiceEmailSubject(input: InvoiceEmailInput): string {
  return `Invoice ${input.invoiceNumber} — ${formatZAR(input.totalCents)} due`;
}

export function renderInvoiceEmailText(input: InvoiceEmailInput): string {
  const bank = getBankingDetails();
  const lines = [
    `Hi ${input.recipientName},`,
    "",
    `Your invoice for ${input.tradingName} is attached.`,
    "",
    `Invoice:  ${input.invoiceNumber}`,
    `Amount:   ${formatZAR(input.totalCents)}`,
  ];
  if (input.dueDate) lines.push(`Due date: ${input.dueDate}`);
  if (input.periodStart && input.periodEnd) {
    lines.push(`Period:   ${input.periodStart} to ${input.periodEnd}`);
  }
  lines.push(
    "",
    "Pay by EFT using these details:",
    `  Bank:            ${bank.bankName}`,
    `  Account name:    ${bank.accountName}`,
    `  Account number:  ${bank.accountNumber}`,
    `  Branch code:     ${bank.branchCode}`,
    `  Reference:       ${input.invoiceNumber}`,
    "",
    "Kind regards,",
    `${getMercataLegalName()} Billing`,
    "billings@mercata.co.za",
  );
  return lines.join("\n");
}

export function renderInvoiceEmailHtml(input: InvoiceEmailInput): string {
  const bank = getBankingDetails();
  const amount = formatZAR(input.totalCents);
  const due = input.dueDate ? esc(input.dueDate) : "—";
  const period =
    input.periodStart && input.periodEnd
      ? `${esc(input.periodStart)} to ${esc(input.periodEnd)}`
      : null;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${esc(renderInvoiceEmailSubject(input))}</title>
</head>
<body style="margin:0;padding:0;background:${emailTokens.bodyBg};">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:${emailTokens.bodyBg};padding:24px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="560" cellspacing="0" cellpadding="0" style="max-width:560px;width:100%;background:${emailTokens.surface};border:1px solid ${emailTokens.border};border-radius:6px;overflow:hidden;">
          <tr>
            <td style="background:${NAVY};padding:22px 28px;">
              <div style="font-family:${emailTokens.fontSerif};font-size:22px;color:#FFFFFF;line-height:1.2;">
                ${esc(getMercataLegalName())}
              </div>
              <div style="font-family:${emailTokens.fontSans};font-size:11px;letter-spacing:0.12em;text-transform:uppercase;color:${GOLD};margin-top:6px;">
                Invoice
              </div>
            </td>
          </tr>
          <tr>
            <td style="padding:28px 28px 8px;font-family:${emailTokens.fontSans};font-size:15px;line-height:1.55;color:${emailTokens.foreground};">
              Hi ${esc(input.recipientName)},
            </td>
          </tr>
          <tr>
            <td style="padding:0 28px 20px;font-family:${emailTokens.fontSans};font-size:15px;line-height:1.55;color:${emailTokens.foreground};">
              Please find invoice <strong style="font-family:${emailTokens.fontSans};">${esc(input.invoiceNumber)}</strong>
              for <strong>${esc(input.tradingName)}</strong> attached as a PDF.
            </td>
          </tr>
          <tr>
            <td style="padding:0 28px 24px;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:${emailTokens.background};border:1px solid ${emailTokens.border};border-radius:4px;">
                <tr>
                  <td style="padding:18px 20px;">
                    <div style="font-family:${emailTokens.fontSans};font-size:11px;letter-spacing:0.08em;text-transform:uppercase;color:${GOLD_STRONG};">
                      Amount due
                    </div>
                    <div style="font-family:${emailTokens.fontSerif};font-size:28px;color:${emailTokens.foreground};margin-top:4px;">
                      ${esc(amount)}
                    </div>
                    <div style="font-family:${emailTokens.fontSans};font-size:13px;color:${emailTokens.muted};margin-top:10px;line-height:1.5;">
                      Due date: <span style="color:${emailTokens.foreground};">${due}</span><br />
                      Invoice: <span style="color:${emailTokens.foreground};">${esc(input.invoiceNumber)}</span>
                      ${period ? `<br />Period: <span style="color:${emailTokens.foreground};">${period}</span>` : ""}
                    </div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:0 28px 8px;font-family:${emailTokens.fontSans};font-size:12px;letter-spacing:0.08em;text-transform:uppercase;color:${emailTokens.muted};">
              EFT payment details
            </td>
          </tr>
          <tr>
            <td style="padding:0 28px 24px;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="font-family:${emailTokens.fontSans};font-size:13px;color:${emailTokens.foreground};">
                <tr>
                  <td style="padding:4px 0;color:${emailTokens.muted};width:140px;">Bank</td>
                  <td style="padding:4px 0;">${esc(bank.bankName)}</td>
                </tr>
                <tr>
                  <td style="padding:4px 0;color:${emailTokens.muted};">Account name</td>
                  <td style="padding:4px 0;">${esc(bank.accountName)}</td>
                </tr>
                <tr>
                  <td style="padding:4px 0;color:${emailTokens.muted};">Account number</td>
                  <td style="padding:4px 0;font-family:ui-monospace,Menlo,Consolas,monospace;">${esc(bank.accountNumber)}</td>
                </tr>
                <tr>
                  <td style="padding:4px 0;color:${emailTokens.muted};">Branch code</td>
                  <td style="padding:4px 0;font-family:ui-monospace,Menlo,Consolas,monospace;">${esc(bank.branchCode)}</td>
                </tr>
                <tr>
                  <td style="padding:4px 0;color:${emailTokens.muted};">Reference</td>
                  <td style="padding:4px 0;font-family:ui-monospace,Menlo,Consolas,monospace;font-weight:600;">${esc(input.invoiceNumber)}</td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:0 28px 28px;font-family:${emailTokens.fontSans};font-size:14px;line-height:1.55;color:${emailTokens.muted};">
              Kind regards,<br />
              <span style="color:${emailTokens.foreground};">${esc(getMercataLegalName())} Billing</span><br />
              <a href="mailto:billings@mercata.co.za" style="color:${NAVY};text-decoration:none;">billings@mercata.co.za</a>
            </td>
          </tr>
          <tr>
            <td style="background:${emailTokens.background};border-top:1px solid ${emailTokens.border};padding:14px 28px;font-family:${emailTokens.fontSans};font-size:11px;color:${emailTokens.muted};">
              PDF attached · Please use the invoice number as your payment reference
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}
