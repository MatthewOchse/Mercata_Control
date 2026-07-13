import type { RowDataPacket } from "mysql2/promise";
import { sastToday } from "@/lib/billing/cycle";
import { query } from "@/lib/db/pool";
import type {
  AddonRecord,
  AuditRow,
  ContactRecord,
  InfraRecord,
  InvoiceSummary,
  PaymentSummary,
  PlanRow,
  SubscriptionRecord,
  TenantListRow,
  TenantRecord,
  TenantStatus,
} from "@/lib/tenants/types";

type ListRow = RowDataPacket & {
  id: number;
  slug: string;
  trading_name: string;
  legal_name: string;
  status: TenantStatus;
  plan_code: string | null;
  plan_name: string | null;
  plan_mrr: number | null;
  addon_mrr: number | null;
  last_invoice_status: string | null;
  last_invoice_number: string | null;
  health_ok: number | null;
  health_open_critical: number;
  health_open_warning: number;
};

export async function listPlans(): Promise<PlanRow[]> {
  const rows = await query<(PlanRow & RowDataPacket)[]>(
    `SELECT code, name, monthly_cents FROM plans WHERE active = 1 ORDER BY monthly_cents`,
  );
  return rows.map((r) => ({
    code: r.code,
    name: r.name,
    monthly_cents: Number(r.monthly_cents),
  }));
}

export async function listTenants(): Promise<TenantListRow[]> {
  const today = sastToday();
  const rows = await query<ListRow[]>(
    `SELECT
       t.id, t.slug, t.trading_name, t.legal_name, t.status,
       s.plan_code,
       p.name AS plan_name,
       s.current_monthly_cents AS plan_mrr,
       (
         SELECT COALESCE(SUM(a.amount_cents), 0)
         FROM addons a
         WHERE a.tenant_id = t.id
           AND a.kind = 'recurring'
           AND a.active_from <= :today
           AND (a.active_until IS NULL OR a.active_until >= :today)
       ) AS addon_mrr,
       (
         SELECT i.status FROM invoices i
         WHERE i.tenant_id = t.id
         ORDER BY COALESCE(i.issue_date, i.created_at) DESC, i.id DESC
         LIMIT 1
       ) AS last_invoice_status,
       (
         SELECT i.invoice_number FROM invoices i
         WHERE i.tenant_id = t.id
         ORDER BY COALESCE(i.issue_date, i.created_at) DESC, i.id DESC
         LIMIT 1
       ) AS last_invoice_number,
       (
         SELECT hc.ok FROM health_checks hc
         WHERE hc.tenant_id = t.id
         ORDER BY hc.checked_at DESC LIMIT 1
       ) AS health_ok,
       (
         SELECT COUNT(*) FROM alert_states a
         WHERE a.tenant_id = t.id AND a.status = 'open' AND a.severity = 'critical'
       ) AS health_open_critical,
       (
         SELECT COUNT(*) FROM alert_states a
         WHERE a.tenant_id = t.id AND a.status = 'open' AND a.severity = 'warning'
       ) AS health_open_warning
     FROM tenants t
     LEFT JOIN subscriptions s
       ON s.id = (
         SELECT s2.id FROM subscriptions s2
         WHERE s2.tenant_id = t.id
           AND s2.status = 'active'
           AND s2.started_on <= :today
           AND (s2.ends_on IS NULL OR s2.ends_on >= :today)
         ORDER BY s2.started_on DESC, s2.id DESC
         LIMIT 1
       )
     LEFT JOIN plans p ON p.code = s.plan_code
     ORDER BY
       FIELD(t.status, 'active', 'prospect', 'suspended', 'offboarded'),
       t.trading_name`,
    { today },
  );

  return rows.map((r) => ({
    id: Number(r.id),
    slug: r.slug,
    trading_name: r.trading_name,
    legal_name: r.legal_name,
    status: r.status,
    plan_code: r.plan_code,
    plan_name: r.plan_name,
    mrr_cents: Number(r.plan_mrr ?? 0) + Number(r.addon_mrr ?? 0),
    last_invoice_status: r.last_invoice_status,
    last_invoice_number: r.last_invoice_number,
    health_ok: r.health_ok === null ? null : Boolean(r.health_ok),
    health_open_critical: Number(r.health_open_critical) > 0,
    health_open_warning: Number(r.health_open_warning) > 0,
  }));
}

export async function getTenantBySlug(
  slug: string,
): Promise<TenantRecord | null> {
  const rows = await query<(TenantRecord & RowDataPacket)[]>(
    `SELECT id, slug, legal_name, trading_name, status,
            onboarded_at, offboarded_at, notes,
            digest_cadence, digest_day, ga4_property_id,
            brand_primary_color, brand_logo_url, created_at
     FROM tenants WHERE slug = :slug LIMIT 1`,
    { slug },
  );
  const row = rows[0];
  if (!row) return null;
  return {
    ...row,
    id: Number(row.id),
    digest_day: Number(row.digest_day),
  };
}

export async function getTenantContacts(
  tenantId: number,
): Promise<ContactRecord[]> {
  const rows = await query<(ContactRecord & RowDataPacket)[]>(
    `SELECT id, name, email, phone, whatsapp_number, whatsapp_opt_in, role, is_primary
     FROM tenant_contacts WHERE tenant_id = :tenantId
     ORDER BY is_primary DESC, FIELD(role, 'primary', 'billing', 'technical'), name`,
    { tenantId },
  );
  return rows.map((r) => ({
    ...r,
    id: Number(r.id),
    whatsapp_opt_in: Number(r.whatsapp_opt_in),
  }));
}

export async function getTenantInfra(
  tenantId: number,
): Promise<InfraRecord | null> {
  const rows = await query<(Omit<InfraRecord, "extra_domains"> & RowDataPacket & { extra_domains: string | null })[]>(
    `SELECT id, primary_domain, extra_domains, container_name, db_name, host, fleet_secret, health_path
     FROM tenant_infra WHERE tenant_id = :tenantId LIMIT 1`,
    { tenantId },
  );
  const row = rows[0];
  if (!row) return null;
  let extra: string[] | null = null;
  if (row.extra_domains) {
    if (Array.isArray(row.extra_domains)) {
      extra = row.extra_domains as string[];
    } else if (typeof row.extra_domains === "string") {
      try {
        extra = JSON.parse(row.extra_domains) as string[];
      } catch {
        extra = null;
      }
    }
  }
  return {
    id: Number(row.id),
    primary_domain: row.primary_domain,
    extra_domains: extra,
    container_name: row.container_name,
    db_name: row.db_name,
    host: row.host,
    fleet_secret: row.fleet_secret,
    health_path: row.health_path,
  };
}

export async function getSubscriptions(
  tenantId: number,
): Promise<SubscriptionRecord[]> {
  const rows = await query<(SubscriptionRecord & RowDataPacket)[]>(
    `SELECT s.id, s.plan_code, p.name AS plan_name, s.status,
            s.started_on, s.ends_on, s.current_monthly_cents
     FROM subscriptions s
     INNER JOIN plans p ON p.code = s.plan_code
     WHERE s.tenant_id = :tenantId
     ORDER BY s.started_on DESC, s.id DESC`,
    { tenantId },
  );
  return rows.map((r) => ({
    id: Number(r.id),
    plan_code: r.plan_code,
    plan_name: r.plan_name,
    status: r.status,
    started_on: String(r.started_on).slice(0, 10),
    ends_on: r.ends_on ? String(r.ends_on).slice(0, 10) : null,
    current_monthly_cents: Number(r.current_monthly_cents),
  }));
}

export function currentSubscription(
  subs: SubscriptionRecord[],
  today = sastToday(),
): SubscriptionRecord | null {
  return (
    subs.find(
      (s) =>
        s.status === "active" &&
        s.started_on <= today &&
        (s.ends_on === null || s.ends_on >= today),
    ) ?? null
  );
}

export async function getAddons(tenantId: number): Promise<AddonRecord[]> {
  const rows = await query<(AddonRecord & RowDataPacket)[]>(
    `SELECT id, description, kind, amount_cents, active_from, active_until
     FROM addons WHERE tenant_id = :tenantId
     ORDER BY active_from DESC, id DESC`,
    { tenantId },
  );
  return rows.map((r) => ({
    id: Number(r.id),
    description: r.description,
    kind: r.kind,
    amount_cents: Number(r.amount_cents),
    active_from: String(r.active_from).slice(0, 10),
    active_until: r.active_until ? String(r.active_until).slice(0, 10) : null,
  }));
}

export function activeRecurringMrr(
  addons: AddonRecord[],
  today = sastToday(),
): number {
  return addons
    .filter(
      (a) =>
        a.kind === "recurring" &&
        a.active_from <= today &&
        (a.active_until === null || a.active_until >= today),
    )
    .reduce((sum, a) => sum + a.amount_cents, 0);
}

export async function getInvoices(
  tenantId: number,
): Promise<InvoiceSummary[]> {
  const rows = await query<(InvoiceSummary & RowDataPacket)[]>(
    `SELECT id, invoice_number, status, issue_date, due_date,
            period_start, period_end, total_cents
     FROM invoices WHERE tenant_id = :tenantId
     ORDER BY COALESCE(issue_date, created_at) DESC, id DESC`,
    { tenantId },
  );
  return rows.map((r) => ({
    id: Number(r.id),
    invoice_number: r.invoice_number,
    status: r.status,
    issue_date: r.issue_date ? String(r.issue_date).slice(0, 10) : null,
    due_date: r.due_date ? String(r.due_date).slice(0, 10) : null,
    period_start: String(r.period_start).slice(0, 10),
    period_end: String(r.period_end).slice(0, 10),
    total_cents: Number(r.total_cents),
  }));
}

export async function getPayments(
  tenantId: number,
): Promise<PaymentSummary[]> {
  const rows = await query<(PaymentSummary & RowDataPacket)[]>(
    `SELECT id, invoice_id, amount_cents, method, reference, received_on, captured_by
     FROM payments WHERE tenant_id = :tenantId
     ORDER BY received_on DESC, id DESC`,
    { tenantId },
  );
  return rows.map((r) => ({
    id: Number(r.id),
    invoice_id: r.invoice_id === null ? null : Number(r.invoice_id),
    amount_cents: Number(r.amount_cents),
    method: r.method,
    reference: r.reference,
    received_on: String(r.received_on).slice(0, 10),
    captured_by: r.captured_by,
  }));
}

/** Outstanding = issued/overdue invoice totals − allocated payments (integer cents). */
export async function outstandingBalanceCents(
  tenantId: number,
): Promise<number> {
  const inv = await query<({ total: number } & RowDataPacket)[]>(
    `SELECT COALESCE(SUM(total_cents), 0) AS total
     FROM invoices
     WHERE tenant_id = :tenantId AND status IN ('issued', 'overdue')`,
    { tenantId },
  );
  const pay = await query<({ total: number } & RowDataPacket)[]>(
    `SELECT COALESCE(SUM(p.amount_cents), 0) AS total
     FROM payments p
     INNER JOIN invoices i ON i.id = p.invoice_id
     WHERE p.tenant_id = :tenantId AND i.status IN ('issued', 'overdue', 'paid')`,
    { tenantId },
  );
  // Simpler: sum issued+overdue totals minus payments allocated to those invoices
  const owed = Number(inv[0]?.total ?? 0);
  const allocated = await query<({ total: number } & RowDataPacket)[]>(
    `SELECT COALESCE(SUM(p.amount_cents), 0) AS total
     FROM payments p
     INNER JOIN invoices i ON i.id = p.invoice_id
     WHERE p.tenant_id = :tenantId AND i.status IN ('issued', 'overdue')`,
    { tenantId },
  );
  void pay;
  return owed - Number(allocated[0]?.total ?? 0);
}

export async function getTenantAuditLog(
  tenantId: number,
  slug: string,
): Promise<AuditRow[]> {
  const rows = await query<(AuditRow & RowDataPacket)[]>(
    `SELECT id, actor, action, entity_type, entity_id, before_json, after_json, created_at
     FROM audit_log
     WHERE (entity_type = 'tenant' AND entity_id = :id)
        OR (entity_type IN ('subscription', 'addon', 'tenant_infra', 'tenant_contact')
            AND (
              JSON_UNQUOTE(JSON_EXTRACT(after_json, '$.tenant_id')) = :idStr
              OR JSON_UNQUOTE(JSON_EXTRACT(before_json, '$.tenant_id')) = :idStr
              OR JSON_UNQUOTE(JSON_EXTRACT(after_json, '$.slug')) = :slug
              OR JSON_UNQUOTE(JSON_EXTRACT(before_json, '$.slug')) = :slug
            ))
     ORDER BY created_at DESC, id DESC
     LIMIT 200`,
    { id: tenantId, idStr: String(tenantId), slug },
  );
  return rows.map((r) => ({
    id: Number(r.id),
    actor: r.actor,
    action: r.action,
    entity_type: r.entity_type,
    entity_id: String(r.entity_id),
    before_json: r.before_json,
    after_json: r.after_json,
    created_at: r.created_at,
  }));
}
