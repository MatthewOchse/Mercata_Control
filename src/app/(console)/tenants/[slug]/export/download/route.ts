import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { NextResponse } from "next/server";
import { requireOperator } from "@/lib/auth/server";

export async function GET(
  request: Request,
  context: { params: Promise<{ slug: string }> },
) {
  await requireOperator();
  const { slug } = await context.params;
  const url = new URL(request.url);
  const base = url.searchParams.get("base") ?? "";
  const fmt = url.searchParams.get("fmt") === "csv" ? "csv" : "json";

  if (
    !base ||
    base.includes("..") ||
    base.includes("/") ||
    !base.startsWith(`${slug}-export-`)
  ) {
    return new NextResponse("Not found", { status: 404 });
  }

  const filePath = join(process.cwd(), ".data", "exports", `${base}.${fmt}`);
  try {
    const body = await readFile(filePath);
    return new NextResponse(body, {
      headers: {
        "Content-Type":
          fmt === "csv" ? "text/csv; charset=utf-8" : "application/json",
        "Content-Disposition": `attachment; filename="${base}.${fmt}"`,
      },
    });
  } catch {
    return new NextResponse("Not found", { status: 404 });
  }
}
