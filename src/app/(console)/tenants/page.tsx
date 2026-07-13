import Link from "next/link";
import { TopBar } from "@/components/layout/top-bar";
import { Money, StatusPill } from "@/components/ui/status";
import { listTenants } from "@/lib/tenants/queries";
import {
  invoiceStatusLabel,
  invoiceStatusTone,
  tenantStatusLabel,
  tenantStatusTone,
} from "@/lib/tenants/status";

export default async function TenantsPage() {
  const tenants = await listTenants();

  return (
    <>
      <TopBar title="Tenants" />
      <main className="p-5">
        <div className="mb-3 flex items-center justify-between gap-3">
          <p className="text-[13px] text-muted">
            {tenants.length} tenant{tenants.length === 1 ? "" : "s"}
          </p>
          <Link
            href="/tenants/new"
            className="inline-flex h-8 items-center rounded-[4px] bg-accent-strong px-3 text-[13px] font-semibold text-white hover:opacity-95"
          >
            New tenant
          </Link>
        </div>

        <table className="admin-table">
          <thead>
            <tr>
              <th>Trading name</th>
              <th>Plan</th>
              <th className="text-right">MRR</th>
              <th>Status</th>
              <th>Health</th>
              <th>Last invoice</th>
            </tr>
          </thead>
          <tbody>
            {tenants.length === 0 ? (
              <tr>
                <td colSpan={6} className="text-muted">
                  No tenants yet.{" "}
                  <Link href="/tenants/new" className="text-accent-strong underline">
                    Create one
                  </Link>
                  .
                </td>
              </tr>
            ) : (
              tenants.map((t) => (
                <tr key={t.id}>
                  <td>
                    <Link
                      href={`/tenants/${t.slug}`}
                      className="font-medium text-foreground hover:text-accent-strong"
                    >
                      {t.trading_name}
                    </Link>
                    <div className="font-mono text-[11px] text-muted">{t.slug}</div>
                  </td>
                  <td>{t.plan_name ?? "—"}</td>
                  <td className="text-right">
                    <Money
                      cents={t.mrr_cents}
                      className="font-medium text-accent-strong"
                    />
                  </td>
                  <td>
                    <StatusPill
                      tone={tenantStatusTone(t.status)}
                      label={tenantStatusLabel(t.status)}
                    />
                  </td>
                  <td>
                    {t.health_ok === null ? (
                      <StatusPill tone="idle" label="Unknown" />
                    ) : t.health_open_critical || t.health_ok === false ? (
                      <StatusPill tone="error" label="Down" />
                    ) : t.health_open_warning ? (
                      <StatusPill tone="warn" label="Degraded" />
                    ) : (
                      <StatusPill tone="ok" label="Healthy" />
                    )}
                  </td>
                  <td>
                    {t.last_invoice_status ? (
                      <div className="flex flex-col gap-0.5">
                        <StatusPill
                          tone={invoiceStatusTone(t.last_invoice_status)}
                          label={invoiceStatusLabel(t.last_invoice_status)}
                        />
                        {t.last_invoice_number ? (
                          <span className="font-mono text-[11px] text-muted">
                            {t.last_invoice_number}
                          </span>
                        ) : null}
                      </div>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </main>
    </>
  );
}
