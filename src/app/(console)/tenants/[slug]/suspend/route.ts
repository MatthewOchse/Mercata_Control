import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { requireOperator } from "@/lib/auth/server";
import { suspendTenant } from "@/lib/tenants/service";

export async function POST(
  req: Request,
  ctx: { params: Promise<{ slug: string }> },
) {
  try {
    await requireOperator();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { slug } = await ctx.params;
  let body: { reason?: string; confirmSlug?: string } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "JSON body required" }, { status: 400 });
  }

  const operator = await requireOperator();
  try {
    await suspendTenant(slug, operator.email, {
      reason: String(body.reason ?? ""),
      confirmSlug: String(body.confirmSlug ?? ""),
    });
    revalidatePath(`/tenants/${slug}`);
    revalidatePath("/tenants");
    revalidatePath("/health");
    return NextResponse.json({
      ok: true,
      message: "Tenant suspended — storefront held; billing continues",
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Suspend failed" },
      { status: 400 },
    );
  }
}
