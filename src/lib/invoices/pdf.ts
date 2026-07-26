import { mkdir, unlink, writeFile, access } from "node:fs/promises";
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
const RULE = "#E2E0DB";
const PANEL = "#F8F7F5";

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
 * Throws if the file already exists — regenerating would alter a legal record
 * unless `replaceExisting` is set (operator template rewrite only).
 */
export async function renderInvoicePdf(
  input: PdfInvoiceInput,
  options?: { replaceExisting?: boolean },
): Promise<{ relativePath: string; absolutePath: string }> {
  const year = Number(input.invoiceNumber.split("-")[1]);
  const relativePath = invoicePdfRelativePath(year, input.invoiceNumber);
  const absolutePath = invoicePdfAbsolutePath(year, input.invoiceNumber);

  if (await pdfAlreadyExists(year, input.invoiceNumber)) {
    if (!options?.replaceExisting) {
      throw new Error(
        `PDF already exists for ${input.invoiceNumber} — legal record must not be regenerated`,
      );
    }
    await unlink(absolutePath);
  }

  await mkdir(join(process.cwd(), "storage", "invoices", String(year)), {
    recursive: true,
  });

  const vatRegistered = isVatRegistered();
  const title = invoiceDocumentTitle(vatRegistered).toUpperCase();
  const bank = getBankingDetails();

  const markPng = await sharp(brandMarkPath())
    .resize(120, 120, {
      fit: "contain",
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer();

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
  const right = pageW - 36;

  // Navy header: brand left, document title right
  doc.rect(0, 0, pageW, 96).fill(NAVY);
  doc.roundedRect(36, 22, 52, 52, 4).fill("#FFFFFF");
  doc.image(goldMark, 42, 28, { width: 40, height: 40 });
  doc
    .fillColor("#FFFFFF")
    .font("Spectral-Bold")
    .fontSize(20)
    .text(getMercataLegalName(), 100, 28, { width: 220 });
  doc
    .font("Plex")
    .fontSize(9)
    .fillColor("#F0C04A")
    .text(getMercataAddress(), 100, 54, { width: 220 });

  doc
    .fillColor("#FFFFFF")
    .font("Spectral-Bold")
    .fontSize(28)
    .text(title, 320, 34, { width: right - 320, align: "right" });

  // Invoice number + meta
  doc
    .fillColor(FG)
    .font("PlexMono-Med")
    .fontSize(13)
    .text(input.invoiceNumber, 36, 116);

  const metaY = 142;
  const labelW = 72;
  function metaRow(label: string, value: string, y: number) {
    doc.font("Plex").fontSize(9).fillColor(MUTED).text(label, 36, y, {
      width: labelW,
    });
    doc.font("PlexMono").fontSize(9).fillColor(FG).text(value, 36 + labelW, y);
  }
  metaRow("Issue date", input.issueDate, metaY);
  metaRow("Due date", input.dueDate, metaY + 14);
  // ASCII "to" — IBM Plex lacks a reliable glyph for → in some builds
  metaRow("Period", `${input.periodStart} to ${input.periodEnd}`, metaY + 28);

  // Bill to
  doc.font("Plex-Semi").fontSize(8).fillColor(MUTED).text("BILL TO", 340, metaY);
  doc
    .font("Plex-Semi")
    .fontSize(11)
    .fillColor(FG)
    .text(input.customer.tradingName, 340, metaY + 14, { width: right - 340 });
  doc
    .font("Plex")
    .fontSize(9)
    .fillColor(MUTED)
    .text(input.customer.legalName, 340, metaY + 30, { width: right - 340 });
  if (input.customer.email) {
    doc.text(input.customer.email, 340, metaY + 44, { width: right - 340 });
  }

  let y = 220;
  if (vatRegistered) {
    const ours = getMercataVatNumber();
    if (ours) {
      doc.font("Plex").fontSize(8).fillColor(MUTED).text(`Mercata VAT ${ours}`, 36, y);
    }
    if (input.customer.vatNumber) {
      doc.text(`Customer VAT ${input.customer.vatNumber}`, 340, y);
    }
    y += 18;
  }

  // Line items
  doc.font("Plex-Semi").fontSize(8).fillColor(MUTED);
  doc.text("DESCRIPTION", 36, y);
  doc.text("QTY", 360, y, { width: 40, align: "right" });
  doc.text("UNIT", 410, y, { width: 70, align: "right" });
  doc.text("AMOUNT", 490, y, { width: 70, align: "right" });
  y += 12;
  doc
    .moveTo(36, y)
    .lineTo(right, y)
    .strokeColor(RULE)
    .lineWidth(0.5)
    .stroke();
  y += 10;

  for (const line of input.lines) {
    doc.font("Plex").fontSize(10).fillColor(FG);
    doc.text(line.description, 36, y, { width: 310 });
    const rowH = Math.max(
      14,
      doc.heightOfString(line.description, { width: 310 }),
    );
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

  y += 6;
  doc
    .moveTo(36, y)
    .lineTo(right, y)
    .strokeColor(GOLD)
    .lineWidth(1)
    .stroke();
  y += 18;

  const totalsX = 360;
  doc.font("Plex").fontSize(10).fillColor(MUTED);
  doc.text("Subtotal", totalsX, y);
  doc
    .font("PlexMono")
    .fillColor(FG)
    .text(formatZAR(input.subtotalCents), 450, y, {
      width: 110,
      align: "right",
    });
  y += 16;

  if (vatRegistered) {
    doc.font("Plex").fillColor(MUTED).text("VAT (15%)", totalsX, y);
    doc
      .font("PlexMono")
      .fillColor(FG)
      .text(formatZAR(input.vatCents), 450, y, {
        width: 110,
        align: "right",
      });
    y += 16;
  }

  y += 6;
  doc.image(goldMark, 400, y, { width: 32, height: 32 });
  doc
    .font("Plex-Semi")
    .fontSize(9)
    .fillColor(GOLD_STRONG)
    .text("AMOUNT DUE", 440, y + 1);
  doc
    .font("Spectral-Bold")
    .fontSize(20)
    .fillColor(FG)
    .text(formatZAR(input.totalCents), 440, y + 14, {
      width: 120,
      align: "left",
    });

  // Payment panel — pinned toward bottom, never overlapping totals
  const panelH = 132;
  const panelY = Math.max(y + 56, doc.page.height - 48 - panelH);
  doc.roundedRect(36, panelY, right - 36, panelH, 4).fill(PANEL);
  doc
    .moveTo(36, panelY)
    .lineTo(right, panelY)
    .strokeColor(GOLD)
    .lineWidth(2)
    .stroke();

  doc
    .font("Plex-Semi")
    .fontSize(9)
    .fillColor(GOLD_STRONG)
    .text("PAYMENT DETAILS", 52, panelY + 14);

  doc
    .font("Plex")
    .fontSize(9)
    .fillColor(MUTED)
    .text(
      "Pay by EFT. Use the invoice number as your payment reference.",
      52,
      panelY + 30,
      { width: right - 68 },
    );

  const col1 = 52;
  const col2 = 300;
  const row1 = panelY + 52;
  const rowGap = 16;

  function bankField(
    label: string,
    value: string,
    x: number,
    rowY: number,
    mono = false,
  ) {
    doc.font("Plex").fontSize(8).fillColor(MUTED).text(label, x, rowY);
    doc
      .font(mono ? "PlexMono-Med" : "Plex-Semi")
      .fontSize(10)
      .fillColor(FG)
      .text(value, x, rowY + 11);
  }

  bankField("Bank", bank.bankName, col1, row1);
  bankField("Account name", bank.accountName, col2, row1);
  bankField("Account number", bank.accountNumber, col1, row1 + rowGap + 8, true);
  bankField("Branch code", bank.branchCode, col2, row1 + rowGap + 8, true);
  bankField("Reference", input.invoiceNumber, col1, row1 + (rowGap + 8) * 2, true);

  doc.end();
  const buffer = await done;
  await writeFile(absolutePath, buffer);

  return { relativePath, absolutePath };
}
