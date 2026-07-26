export type TenantStatus =
  | "prospect"
  | "active"
  | "suspended"
  | "offboarded";

export type PlanCode =
  | "starter"
  | "online"
  | "retail"
  | "retail_pro"
  | "service_hosting";

export type ContactRole = "billing" | "technical" | "primary";

export type TenantListRow = {
  id: number;
  slug: string;
  trading_name: string;
  legal_name: string;
  status: TenantStatus;
  plan_code: string | null;
  plan_name: string | null;
  mrr_cents: number;
  last_invoice_status: string | null;
  last_invoice_number: string | null;
  health_ok: boolean | null;
  health_open_critical: boolean;
  health_open_warning: boolean;
};

export type DigestCadence = "daily" | "weekly" | "monthly" | "off";

export type TenantRecord = {
  id: number;
  /** FK to servers.id — required; every tenant is assigned to a box. */
  server_id: number;
  slug: string;
  legal_name: string;
  trading_name: string;
  status: TenantStatus;
  onboarded_at: Date | string | null;
  offboarded_at: Date | string | null;
  notes: string | null;
  payment_due_days: number;
  billing_day: number;
  digest_cadence: DigestCadence;
  digest_day: number;
  ga4_property_id: string | null;
  ga4_verified_at: Date | string | null;
  ga4_display_name: string | null;
  brand_primary_color: string | null;
  brand_logo_url: string | null;
  created_at: Date | string;
};

export type ContactRecord = {
  id: number;
  name: string;
  email: string;
  phone: string | null;
  whatsapp_number: string | null;
  whatsapp_opt_in: number;
  role: ContactRole;
  is_primary: number;
  receive_invoices: number;
  receive_digests: number;
};

export type InfraRecord = {
  id: number;
  primary_domain: string;
  extra_domains: string[] | null;
  container_name: string;
  db_name: string;
  host: string;
  fleet_secret: string;
  health_path: string;
};

export type SubscriptionRecord = {
  id: number;
  plan_code: string;
  plan_name: string;
  status: "active" | "cancelled";
  started_on: string;
  ends_on: string | null;
  current_monthly_cents: number;
};

export type AddonRecord = {
  id: number;
  description: string;
  kind: "recurring" | "once_off";
  amount_cents: number;
  active_from: string;
  active_until: string | null;
};

export type InvoiceSummary = {
  id: number;
  invoice_number: string | null;
  status: string;
  issue_date: string | null;
  due_date: string | null;
  period_start: string;
  period_end: string;
  total_cents: number;
  has_pdf: boolean;
};

export type PaymentSummary = {
  id: number;
  invoice_id: number | null;
  amount_cents: number;
  method: string;
  reference: string | null;
  received_on: string;
  captured_by: string;
};

export type AuditRow = {
  id: number;
  actor: string;
  action: string;
  entity_type: string;
  entity_id: string;
  before_json: unknown;
  after_json: unknown;
  created_at: Date | string;
};

export type PlanRow = {
  code: string;
  name: string;
  monthly_cents: number;
};
