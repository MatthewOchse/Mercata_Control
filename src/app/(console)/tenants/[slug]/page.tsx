import Link from "next/link";
import { notFound } from "next/navigation";
import { TopBar } from "@/components/layout/top-bar";
import { Money, StatusPill } from "@/components/ui/status";
import { formatSastDateTime } from "@/lib/datetime";
import {
  activeRecurringMrr,
  currentSubscription,
  getAddons,
  getInvoices,
  getPayments,
  getSubscriptions,
  getTenantAuditLog,
  getTenantBySlug,
  getTenantContacts,
  getTenantInfra,
  listPlans,
  outstandingBalanceCents,
} from "@/lib/tenants/queries";
import {
  tenantStatusLabel,
  tenantStatusTone,
} from "@/lib/tenants/status";
import { ActivityTab } from "./tabs/activity";
import { AnalyticsTab } from "./tabs/analytics";
import { BillingTab } from "./tabs/billing";
import { DigestTab } from "./tabs/digest";
import { FilesTab } from "./tabs/files";
import { InfraTab } from "./tabs/infra";
import { LifecyclePanel } from "./lifecycle-panel";
import { OverviewTab } from "./tabs/overview";

const TABS = [
  { id: "overview", label: "Overview" },
  { id: "billing", label: "Billing" },
  { id: "files", label: "Files" },
  { id: "analytics", label: "Analytics" },
  { id: "digest", label: "Digest" },
  { id: "infra", label: "Infra" },
  { id: "activity", label: "Activity" },
] as const;

type TabId = (typeof TABS)[number]["id"];

export default async function TenantDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ tab?: string; period?: string }>;
}) {
  const { slug } = await params;
  const sp = await searchParams;
  const tab = (TABS.some((t) => t.id === sp.tab) ? sp.tab : "overview") as TabId;

  const tenant = await getTenantBySlug(slug);
  if (!tenant) notFound();

  const [
    contacts,
    infra,
    subscriptions,
    addons,
    invoices,
    payments,
    outstanding,
    audit,
    plans,
  ] = await Promise.all([
    getTenantContacts(tenant.id),
    getTenantInfra(tenant.id),
    getSubscriptions(tenant.id),
    getAddons(tenant.id),
    getInvoices(tenant.id),
    getPayments(tenant.id),
    outstandingBalanceCents(tenant.id),
    getTenantAuditLog(tenant.id, tenant.slug),
    listPlans(),
  ]);

  const current = currentSubscription(subscriptions);
  const mrr =
    (current?.current_monthly_cents ?? 0) + activeRecurringMrr(addons);

  const periodKey =
    sp.period === "1d" ||
    sp.period === "7d" ||
    sp.period === "28d" ||
    sp.period === "30d" ||
    sp.period === "90d" ||
    sp.period === "this_vs_last_month"
      ? sp.period
      : "1d";
  const analyticsView =
    tab === "analytics" || tab === "overview"
      ? await (
          await import("@/lib/analytics/queries")
        ).getTenantAnalyticsView(tenant.id, periodKey)
      : null;

  return (
    <>
      <TopBar title={tenant.trading_name} />
      <main className="p-5">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-[18px] font-semibold text-foreground">
                {tenant.trading_name}
              </h2>
              <StatusPill
                tone={tenantStatusTone(tenant.status)}
                label={tenantStatusLabel(tenant.status)}
              />
              <StatusPill tone="idle" label="Unknown" />
            </div>
            <div className="mt-1 flex flex-wrap gap-3 text-[12px] text-muted">
              <span className="font-mono">{tenant.slug}</span>
              <span>{tenant.legal_name}</span>
              {current ? (
                <span>
                  {current.plan_name} ·{" "}
                  <Money cents={mrr} className="text-accent-strong" />
                  /mo
                </span>
              ) : null}
            </div>
          </div>
          <Link
            href="/tenants"
            className="text-[13px] text-muted hover:text-foreground"
          >
            ← Tenants
          </Link>
        </div>

        <LifecyclePanel
          slug={tenant.slug}
          status={tenant.status}
          plans={plans}
          currentPlanCode={current?.plan_code ?? null}
        />

        <nav className="mt-5 flex gap-1 border-b border-border">
          {TABS.map((t) => {
            const active = tab === t.id;
            return (
              <Link
                key={t.id}
                href={`/tenants/${tenant.slug}?tab=${t.id}`}
                className={`relative px-3 py-2 text-[13px] ${
                  active
                    ? "font-semibold text-foreground"
                    : "text-muted hover:text-foreground"
                }`}
              >
                {t.label}
                {active ? (
                  <span className="absolute inset-x-3 -bottom-px h-0.5 bg-accent" />
                ) : null}
              </Link>
            );
          })}
        </nav>

        <div className="mt-4">
          {tab === "overview" ? (
            <div className="space-y-6">
              <OverviewTab
                tenant={tenant}
                contacts={contacts}
                infra={infra}
                current={current}
                mrrCents={mrr}
              />
              {analyticsView ? (
                <section>
                  <h3 className="mb-3 text-[12px] font-semibold tracking-wide text-muted uppercase">
                    Traffic &amp; sales
                  </h3>
                  <AnalyticsTab
                    slug={tenant.slug}
                    view={analyticsView}
                    tab="overview"
                  />
                </section>
              ) : null}
            </div>
          ) : null}
          {tab === "billing" ? (
            <BillingTab
              slug={tenant.slug}
              status={tenant.status}
              subscriptions={subscriptions}
              addons={addons}
              invoices={invoices}
              payments={payments}
              outstandingCents={outstanding}
              catalogMonthlyCents={
                current
                  ? (plans.find((p) => p.code === current.plan_code)
                      ?.monthly_cents ?? null)
                  : null
              }
              billingDay={tenant.billing_day}
              plans={plans}
            />
          ) : null}
          {tab === "files" ? (
            <FilesTab tenantId={tenant.id} tenantSlug={tenant.slug} />
          ) : null}
          {tab === "analytics" && analyticsView ? (
            <AnalyticsTab slug={tenant.slug} view={analyticsView} />
          ) : null}
          {tab === "digest" ? (
            <DigestTab
              slug={tenant.slug}
              cadence={tenant.digest_cadence}
              digestDay={tenant.digest_day}
              ga4PropertyId={tenant.ga4_property_id}
              ga4VerifiedAt={
                tenant.ga4_verified_at
                  ? String(tenant.ga4_verified_at)
                  : null
              }
              ga4DisplayName={tenant.ga4_display_name}
              brandPrimaryColor={tenant.brand_primary_color}
              brandLogoUrl={tenant.brand_logo_url}
            />
          ) : null}
          {tab === "infra" ? (
            <InfraTab slug={tenant.slug} infra={infra} status={tenant.status} />
          ) : null}
          {tab === "activity" ? (
            <ActivityTab rows={audit} formatSastDateTime={formatSastDateTime} />
          ) : null}
        </div>
      </main>
    </>
  );
}
