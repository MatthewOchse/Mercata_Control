import { mkdir, writeFile, access } from "node:fs/promises";
import { join } from "node:path";
import { join as posixJoin } from "node:path/posix";
import PDFDocument from "pdfkit";
import sharp from "sharp";
import { isVatRegistered } from "@/lib/env";
import {
  getBankingDetails,
  getMercataAddress,
  getMercataLegalName,
  getMercataVatNumber,
} from "@/lib/invoices/company";
import { invoiceDocumentTitle } from "@/lib/invoices/invariants";
import { formatCentsPlain, formatZAR } from "@/lib/money";

export type PdfLine = {
  description: string;
  quantity: number;
  unitCents: number;
  lineTotalCents: number;
};

export type PdfInvoiceInput = {
  invoiceNumber: string;
  issueDate: string;
  dueDate: string;
  periodStart: string;
  periodEnd: string;
  subtotalCents: number;
  vatCents: number;
  totalCents: number;
  customer: {
    legalName: string;
    tradingName: string;
    vatNumber: string | null;
    email?: string | null;
  };
  lines: PdfLine[];
};

const NAVY = "#1A2B4A";
const GOLD = "#E0A82E";
const GOLD_STRONG = "#946F09";
const FG = "#121820";
const MUTED = "#5C6470";

function fontsDir(): string {
  return join(process.cwd(), "assets", "fonts");
}

function brandMarkPath(): string {
  return join(process.cwd(), "public", "brand", "mercata-notext.webp");
}

/** Relative storage path — legal record; never regenerate once written. */
export function invoicePdfRelativePath(
  year: number,
  invoiceNumber: string,
): string {
  return posixJoin("storage", "invoices", String(year), `${invoiceNumber}.pdf`);
}

export function invoicePdfAbsolutePath(
  year: number,
  invoiceNumber: string,
): string {
  return join(process.cwd(), invoicePdfRelativePath(year, invoiceNumber));
}

export async function pdfAlreadyExists(
  year: number,
  invoiceNumber: string,
): Promise<boolean> {
  try {
    await access(invoicePdfAbsolutePath(year, invoiceNumber));
    return true;
  } catch {
    return false;
  }
}

/**
 * Render invoice PDF once at issue time.
 * Throws if the file already exists — regenerating would alter a legal record.
 */
export async function renderInvoicePdf(
  input: PdfInvoiceInput,
): Promise<{ relativePath: string; absolutePath: string }> {
  const year = Number(input.invoiceNumber.split("-")[1]);
  const relativePath = invoicePdfRelativePath(year, input.invoiceNumber);
  const absolutePath = invoicePdfAbsolutePath(year, input.invoiceNumber);

  if (await pdfAlreadyExists(year, input.invoiceNumber)) {
    throw new Error(
      `PDF already exists for ${input.invoiceNumber} — legal record must not be regenerated`,
    );
  }

  await mkdir(join(process.cwd(), "storage", "invoices", String(year)), {
    recursive: true,
  });

  const vatRegistered = isVatRegistered();
  const title = invoiceDocumentTitle(vatRegistered);
  const bank = getBankingDetails();

  const markPng = await sharp(brandMarkPath())
    .resize(120, 120, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();

  // Gold-tint the mark for reverse-out on navy: composite gold over alpha
  const goldMark = await sharp(markPng)
    .ensureAlpha()
    .tint({ r: 224, g: 168, b: 46 })
    .png()
    .toBuffer();

  const doc = new PDFDocument({
    size: "A4",
    margins: { top: 0, left: 0, right: 0, bottom: 48 },
    bufferPages: true,
  });

  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));

  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  const F = fontsDir();
  doc.registerFont("Spectral", join(F, "Spectral-Regular.ttf"));
  doc.registerFont("Spectral-Bold", join(F, "Spectral-Bold.ttf"));
  doc.registerFont("Plex", join(F, "IBMPlexSans-Regular.ttf"));
  doc.registerFont("Plex-Semi", join(F, "IBMPlexSans-SemiBold.ttf"));
  doc.registerFont("PlexMono", join(F, "IBMPlexMono-Regular.ttf"));
  doc.registerFont("PlexMono-Med", join(F, "IBMPlexMono-Medium.ttf"));

  const pageW = doc.page.width;

  // Navy header band
  doc.rect(0, 0, pageW, 88).fill(NAVY);
  doc.image(goldMark, 36, 18, { width: 52, height: 52 });
  doc
    .fillColor("#FFFFFF")
    .font("Spectral-Bold")
    .fontSize(22)
    .text(getMercataLegalName(), 100, 28, { width: 280 });
  doc
    .font("Plex")
    .fontSize(9)
    .fillColor("#F0C04A")
    .text(getMercataAddress(), 100, 56, { width: 280 });

  doc
    .fillColor("#FFFFFF")
    .font("Spectral")
    .fontSize(18)
    .text(title, 36, 110, { align: "left" });

  doc
    .fillColor(FG)
    .font("PlexMono-Med")
    .fontSize(14)
    .text(input.invoiceNumber, 36, 138);

  // Meta
  doc.font("Plex").fontSize(9).fillColor(MUTED);
  doc.text(`Issue date  ${input.issueDate}`, 36, 165);
  doc.text(`Due date    ${input.dueDate}`, 36, 178);
  doc.text(`Period      ${input.periodStart} → ${input.periodEnd}`, 36, 191);

  // Bill to
  doc.font("Plex-Semi").fontSize(9).fillColor(MUTED).text("BILL TO", 320, 165);
  doc.font("Plex-Semi").fontSize(11).fillColor(FG).text(input.customer.tradingName, 320, 178);
  doc.font("Plex").fontSize(9).fillColor(MUTED).text(input.customer.legalName, 320, 194);
  if (vatRegistered) {
    const ours = getMercataVatNumber();
    if (ours) {
      doc.text(`Mercata VAT: ${ours}`, 36, 210);
    }
    if (input.customer.vatNumber) {
      doc.text(`Customer VAT: ${input.customer.vatNumber}`, 320, 210);
    }
  }

  // Line items
  let y = 250;
  doc.font("Plex-Semi").fontSize(8).fillColor(MUTED);
  doc.text("DESCRIPTION", 36, y);
  doc.text("QTY", 360, y, { width: 40, align: "right" });
  doc.text("UNIT", 410, y, { width: 70, align: "right" });
  doc.text("AMOUNT", 490, y, { width: 70, align: "right" });
  y += 14;
  doc
    .moveTo(36, y)
    .lineTo(pageW - 36, y)
    .strokeColor("#E2E0DB")
    .lineWidth(0.5)
    .stroke();
  y += 10;

  for (const line of input.lines) {
    doc.font("Plex").fontSize(10).fillColor(FG);
    doc.text(line.description, 36, y, { width: 310 });
    const rowH = Math.max(14, doc.heightOfString(line.description, { width: 310 }));
    doc.font("PlexMono").fontSize(10);
    doc.text(String(line.quantity), 360, y, { width: 40, align: "right" });
    doc.text(formatCentsPlain(line.unitCents), 410, y, {
      width: 70,
      align: "right",
    });
    doc.text(formatCentsPlain(line.lineTotalCents), 490, y, {
      width: 70,
      align: "right",
    });
    y += rowH + 8;
  }

  // Gold hairline above totals
  y += 8;
  doc
    .moveTo(36, y)
    .lineTo(pageW - 36, y)
    .strokeColor(GOLD)
    .lineWidth(1)
    .stroke();
  y += 20;

  // Totals + arch-anchored amount due
  const totalsX = 360;
  doc.font("Plex").fontSize(10).fillColor(MUTED);
  doc.text("Subtotal", totalsX, y);
  doc
    .font("PlexMono")
    .fillColor(FG)
    .text(formatZAR(input.subtotalCents), 450, y, { width: 110, align: "right" });
  y += 16;

  if (vatRegistered) {
    doc.font("Plex").fillColor(MUTED).text("VAT (15%)", totalsX, y);
    doc
      .font("PlexMono")
      .fillColor(FG)
      .text(formatZAR(input.vatCents), 450, y, { width: 110, align: "right" });
    y += 16;
  }

  // Arch mark anchoring the amount due
  y += 8;
  doc.image(goldMark, 400, y, { width: 36, height: 36 });
  doc
    .font("Plex-Semi")
    .fontSize(9)
    .fillColor(GOLD_STRONG)
    .text("AMOUNT DUE", 444, y + 2);
  doc
    .font("Spectral-Bold")
    .fontSize(22)
    .fillColor(FG)
    .text(formatZAR(input.totalCents), 444, y + 14, {
      width: 120,
      align: "left",
    });

  // EFT banking
  const bankY = Math.max(y + 70, 620);
  doc.font("Plex-Semi").fontSize(9).fillColor(MUTED).text("EFT PAYMENT DETAILS", 36, bankY);
  doc.font("Plex").fontSize(10).fillColor(FG);
  doc.text(`Bank: ${bank.bankName}`, 36, bankY + 16);
  doc.text(`Account name: ${bank.accountName}`, 36, bankY + 30);
  doc.font("PlexMono").text(`Account number: ${bank.accountNumber}`, 36, bankY + 44);
  doc.text(`Branch code: ${bank.branchCode}`, 36, bankY + 58);
  doc
    .font("Plex")
    .fontSize(9)
    .fillColor(MUTED)
    .text(
      `Reference: ${input.invoiceNumber}`,
      36,
      bankY + 76,
    );

  doc.end();
  const buffer = await done;
  await writeFile(absolutePath, buffer);

  return { relativePath, absolutePath };
}
