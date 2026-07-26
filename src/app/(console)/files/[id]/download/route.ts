import { readFile } from "node:fs/promises";
import { NextResponse } from "next/server";
import { requireOperator } from "@/lib/auth/server";
import { getBusinessFileById } from "@/lib/files/queries";
import { resolveBusinessFilePath } from "@/lib/files/storage";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  await requireOperator();
  const { id } = await context.params;
  const file = await getBusinessFileById(Number(id));
  if (!file) {
    return new NextResponse("File not found", { status: 404 });
  }

  let absolute: string;
  try {
    absolute = resolveBusinessFilePath(file.storagePath);
  } catch {
    return new NextResponse("Forbidden", { status: 403 });
  }

  try {
    const body = await readFile(absolute);
    const safeName = file.originalName.replace(/["\r\n]/g, "_");
    return new NextResponse(body, {
      headers: {
        "Content-Type": file.mimeType || "application/octet-stream",
        "Content-Disposition": `attachment; filename="${safeName}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch {
    return new NextResponse("File missing on disk", { status: 404 });
  }
}
