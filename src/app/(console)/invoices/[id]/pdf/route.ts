import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { NextResponse } from "next/server";
import { requireOperator } from "@/lib/auth/server";
import { getInvoiceById } from "@/lib/invoices/queries";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  await requireOperator();
  const { id } = await context.params;
  const invoice = await getInvoiceById(Number(id));
  if (!invoice?.pdf_path || !invoice.invoice_number) {
    return new NextResponse("PDF not found", { status: 404 });
  }

  // pdf_path is relative like storage/invoices/2026/MER-2026-0001.pdf
  const absolute = join(process.cwd(), invoice.pdf_path);
  if (!absolute.startsWith(join(process.cwd(), "storage", "invoices"))) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  try {
    const body = await readFile(absolute);
    return new NextResponse(body, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${invoice.invoice_number}.pdf"`,
      },
    });
  } catch {
    return new NextResponse("PDF file missing", { status: 404 });
  }
}
