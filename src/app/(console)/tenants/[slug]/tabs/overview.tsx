import { Money, StatusPill } from "@/components/ui/status";
import { formatSastDateTime } from "@/lib/datetime";
import { formatIsoDate } from "@/lib/billing/cycle";
import {
  tenantStatusLabel,
  tenantStatusTone,
} from "@/lib/tenants/status";
import type {
  ContactRecord,
  InfraRecord,
  SubscriptionRecord,
  TenantRecord,
} from "@/lib/tenants/types";
import { OverviewContactsClient } from "./overview-contacts-client";

export function OverviewTab({
  tenant,
  contacts,
  infra,
  current,
  mrrCents,
}: {
  tenant: TenantRecord;
  contacts: ContactRecord[];
  infra: InfraRecord | null;
  current: SubscriptionRecord | null;
  mrrCents: number;
}) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <section className="rounded-[4px] border border-border bg-surface p-4">
        <h3 className="mb-3 text-[12px] font-semibold tracking-wide text-muted uppercase">
          Status
        </h3>
        <dl className="grid grid-cols-[120px_1fr] gap-y-2 text-[13px]">
          <dt className="text-muted">Lifecycle</dt>
          <dd>
            <StatusPill
              tone={tenantStatusTone(tenant.status)}
              label={tenantStatusLabel(tenant.status)}
            />
          </dd>
          <dt className="text-muted">Plan</dt>
          <dd>{current?.plan_name ?? "—"}</dd>
          <dt className="text-muted">MRR</dt>
          <dd>
            <Money cents={mrrCents} className="font-medium text-accent-strong" />
          </dd>
          <dt className="text-muted">Onboarded</dt>
          <dd>{formatSastDateTime(tenant.onboarded_at)}</dd>
          <dt className="text-muted">Offboarded</dt>
          <dd>{formatSastDateTime(tenant.offboarded_at)}</dd>
          {current ? (
            <>
              <dt className="text-muted">Sub started</dt>
              <dd className="font-mono text-[12px]">
                {formatIsoDate(current.started_on)}
              </dd>
              <dt className="text-muted">Sub ends</dt>
              <dd className="font-mono text-[12px]">
                {formatIsoDate(current.ends_on)}
              </dd>
            </>
          ) : null}
        </dl>
      </section>

      <OverviewContactsClient slug={tenant.slug} contacts={contacts} />

      <section className="rounded-[4px] border border-border bg-surface p-4 lg:col-span-2">
        <h3 className="mb-3 text-[12px] font-semibold tracking-wide text-muted uppercase">
          Infra
        </h3>
        {infra ? (
          <dl className="grid grid-cols-[140px_1fr] gap-y-2 text-[13px] sm:grid-cols-[160px_1fr]">
            <dt className="text-muted">Primary domain</dt>
            <dd className="font-mono text-[12px]">{infra.primary_domain}</dd>
            <dt className="text-muted">Container</dt>
            <dd className="font-mono text-[12px]">{infra.container_name}</dd>
            <dt className="text-muted">Database</dt>
            <dd className="font-mono text-[12px]">{infra.db_name}</dd>
            <dt className="text-muted">Host</dt>
            <dd className="font-mono text-[12px]">{infra.host}</dd>
            <dt className="text-muted">Health path</dt>
            <dd className="font-mono text-[12px]">{infra.health_path}</dd>
          </dl>
        ) : (
          <p className="text-[13px] text-muted">No infra record</p>
        )}
      </section>
    </div>
  );
}
