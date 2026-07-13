import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOperator } from "@/lib/auth/server";
import { getTenantBySlug } from "@/lib/tenants/queries";

export default async function ExportPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ base?: string }>;
}) {
  await requireOperator();
  const { slug } = await params;
  const { base } = await searchParams;
  const tenant = await getTenantBySlug(slug);
  if (!tenant || !base) notFound();

  if (base.includes("..") || base.includes("/") || base.includes("\\")) {
    notFound();
  }
  if (!base.startsWith(`${slug}-export-`)) {
    notFound();
  }

  return (
    <main className="mx-auto max-w-xl p-8">
      <h1 className="mb-2 text-lg font-semibold">Offboard export ready</h1>
      <p className="mb-4 text-[13px] text-muted">
        Tenant <span className="font-mono">{slug}</span> is offboarded. Download
        the data-export bundle below. Invoices, payments, and credit notes remain
        in the database.
      </p>
      <div className="flex flex-col gap-2">
        <a
          className="rounded-[4px] bg-accent-strong px-3 py-2 text-center text-[13px] font-semibold text-white"
          href={`/tenants/${slug}/export/download?base=${encodeURIComponent(base)}&fmt=json`}
        >
          Download JSON
        </a>
        <a
          className="rounded-[4px] border border-border px-3 py-2 text-center text-[13px] font-medium"
          href={`/tenants/${slug}/export/download?base=${encodeURIComponent(base)}&fmt=csv`}
        >
          Download CSV
        </a>
        <Link
          href={`/tenants/${slug}`}
          className="mt-2 text-center text-[13px] text-muted hover:text-foreground"
        >
          Back to tenant
        </Link>
      </div>
    </main>
  );
}
