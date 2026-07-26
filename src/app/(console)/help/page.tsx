import Link from "next/link";
import { TopBar } from "@/components/layout/top-bar";
import { requireOperator } from "@/lib/auth/server";

type FieldRow = {
  field: string;
  required: boolean;
  example: string;
  notes: string;
};

const IDENTITY_FIELDS: FieldRow[] = [
  {
    field: "Tenant id / slug",
    required: true,
    example: "acme",
    notes:
      "Lowercase letter then [a-z0-9-], max 32 chars. Becomes TENANT_ID and the Docker service name. Reserved: crafties, geist, demo-online.",
  },
  {
    field: "Display name",
    required: true,
    example: "Acme Crafts",
    notes: "Human trading name shown in Control CRM after provision succeeds.",
  },
  {
    field: "Domain",
    required: true,
    example: "www.acme.co.za",
    notes:
      "No https://. Sets AUTH_URL, NEXTAUTH_URL, and NEXT_PUBLIC_APP_URL to https://<domain>. Point DNS A/AAAA at the target server’s public IP after success.",
  },
  {
    field: "Billing plan",
    required: true,
    example: "Online — R1,500/mo",
    notes:
      "Any active catalog plan (Starter, Online, Retail, Sites, …). Creates the CRM subscription on success. Pick the commercial product the customer bought.",
  },
  {
    field: "Platform tier (features)",
    required: true,
    example: "online  or  retail",
    notes:
      "Storefront feature set (TENANT_TIER). Defaults from the billing plan: Retail/Retail Pro → retail; Starter/Online/Sites → online. Override only when features must differ from the plan.",
  },
  {
    field: "DB name",
    required: true,
    example: "storedb_acme",
    notes:
      "MySQL database name (MYSQL_DATABASE). Auto-suggests storedb_<slug>. Letters, digits, underscore only.",
  },
];

const SERVER_FIELDS: FieldRow[] = [
  {
    field: "Assign to",
    required: true,
    example: "AUTO — caesar (2/14, 12 free)",
    notes:
      "AUTO picks the active host with the most free slots. Choose a specific server only when you must place on that box.",
  },
  {
    field: "Force override",
    required: false,
    example: "(unchecked)",
    notes:
      "Only when every server is full and you accept over-capacity. Prefer bringing a new host online first.",
  },
];

const ADMIN_FIELDS: FieldRow[] = [
  {
    field: "Admin email",
    required: true,
    example: "admin@acme.co.za",
    notes:
      "Storefront admin login email. Auto-suggests admin@<domain>. Created during provision.",
  },
  {
    field: "Admin password",
    required: true,
    example: "(Generate strong)",
    notes:
      "Min 12 characters. Encrypted one-time hand-off to the host worker — never stored in plaintext and never shown again after submit. Use Generate strong unless the customer mandated a password.",
  },
];

const MYSQL_FIELDS: FieldRow[] = [
  {
    field: "MYSQL_HOST",
    required: false,
    example: "host.docker.internal",
    notes:
      "Leave blank for host default. Inside containers this is the Docker gateway to the box’s MySQL — not Caesar’s Control DB.",
  },
  {
    field: "MYSQL_PORT",
    required: false,
    example: "3306",
    notes:
      "Same for every tenant on a host. All tenants share one MySQL instance; only the database name differs. Default 3306.",
  },
  {
    field: "MYSQL_USER",
    required: false,
    example: "root",
    notes: "Leave blank to use the worker’s provision MySQL user (usually root on the host).",
  },
  {
    field: "MYSQL_PASSWORD",
    required: false,
    example: "(host root password)",
    notes:
      "Leave blank to use the worker env. Only fill when this tenant needs a different DB user password.",
  },
];

const PAYFAST_FIELDS: FieldRow[] = [
  {
    field: "PAYFAST_MERCHANT_ID",
    required: false,
    example: "10000100",
    notes: "From the customer’s PayFast account. Sandbox IDs look similar but enable Sandbox mode.",
  },
  {
    field: "PAYFAST_MERCHANT_KEY",
    required: false,
    example: "46f0cd694581a",
    notes: "Merchant key from PayFast integration settings.",
  },
  {
    field: "PAYFAST_PASSPHRASE",
    required: false,
    example: "AcmePassphrase2026",
    notes: "Optional passphrase configured in PayFast. Must match their dashboard exactly.",
  },
  {
    field: "Sandbox mode",
    required: false,
    example: "(checked for tests)",
    notes: "Use for PayFast sandbox only. Uncheck for live card/EFT payments.",
  },
];

const SHIP_FIELDS: FieldRow[] = [
  {
    field: "SHIPLOGIC_BASE_URL",
    required: false,
    example: "https://api.shiplogic.com",
    notes: "Usually leave blank — fleet defaults to the production ShipLogic portal URL for online tier.",
  },
  {
    field: "SHIPLOGIC_API_KEY",
    required: false,
    example: "cf2e… (customer key)",
    notes: "Courier Guy / ShipLogic API key for door-delivery quotes and labels.",
  },
  {
    field: "Collection JSON",
    required: false,
    example:
      '{"street_address":"12 Oak St","local_area":"Sea Point","city":"Cape Town","code":"8005","zone":"WC","country":"ZA"}',
    notes: "Pickup / collection address as JSON for ShipLogic. Must be valid JSON.",
  },
  {
    field: "TCG_LOCKER_API_KEY",
    required: false,
    example: "56263076|…token…",
    notes: "PUDO / TCG Locker API credential when the tenant offers locker collection.",
  },
  {
    field: "PUDO shipping amount (ZAR)",
    required: false,
    example: "65.00",
    notes: "Flat PUDO fee shown at checkout when lockers are enabled.",
  },
];

const SMTP_FIELDS: FieldRow[] = [
  {
    field: "SMTP_HOST",
    required: false,
    example: "smtp.resend.com",
    notes: "Outbound mail host for order / admin emails from the storefront.",
  },
  {
    field: "SMTP_PORT",
    required: false,
    example: "465",
    notes: "465 (TLS) or 587 (STARTTLS) depending on the provider.",
  },
  {
    field: "SMTP_USER",
    required: false,
    example: "resend",
    notes: "SMTP username (often “resend” for Resend).",
  },
  {
    field: "SMTP_PASS",
    required: false,
    example: "re_…",
    notes: "API key / SMTP password. Encrypted hand-off only — never logged.",
  },
];

const AUTO_FIELDS: FieldRow[] = [
  {
    field: "AUTH_SECRET / NEXTAUTH_SECRET",
    required: false,
    example: "(openssl on host)",
    notes: "Generated by the worker. Do not paste from elsewhere unless rotating deliberately.",
  },
  {
    field: "STORE_ADMIN_SECRET",
    required: false,
    example: "(openssl on host)",
    notes: "Fleet admin API secret for Store Management. Generated on the host.",
  },
  {
    field: "FLEET_SECRET",
    required: false,
    example: "(openssl on host)",
    notes: "Internal fleet auth. Stored encrypted on the CRM tenant_infra row after success.",
  },
  {
    field: "TENANT_FEATURES",
    required: false,
    example: "shop,cart,checkout,…",
    notes: "Derived from platform tier (+ site.json overrides later in Store Management).",
  },
];

export default async function HelpPage() {
  await requireOperator();

  return (
    <>
      <TopBar title="Help" />
      <main className="mx-auto max-w-3xl space-y-6 p-5">
        <section className="rounded-[4px] border border-border bg-surface p-4">
          <h2 className="text-[15px] font-semibold tracking-tight">
            Operator help
          </h2>
          <p className="mt-2 text-[13px] text-muted">
            Short rulebooks for day-to-day Control work. Start with tenant
            onboarding if you are provisioning a live storefront.
          </p>
          <ul className="mt-3 list-inside list-disc text-[13px]">
            <li>
              <a href="#onboard" className="text-accent-strong underline">
                Onboard a tenant (rulebook)
              </a>
            </li>
            <li>
              <a href="#fields" className="text-accent-strong underline">
                Field examples (New tenant form)
              </a>
            </li>
            <li>
              <a href="#after" className="text-accent-strong underline">
                After provision succeeds
              </a>
            </li>
          </ul>
        </section>

        <section
          id="onboard"
          className="scroll-mt-4 rounded-[4px] border border-border bg-surface p-4"
        >
          <h2 className="text-[15px] font-semibold tracking-tight">
            Onboard a tenant — rulebook
          </h2>
          <ol className="mt-3 list-decimal space-y-3 pl-5 text-[13px] leading-relaxed">
            <li>
              <strong className="font-semibold">Confirm the host has capacity.</strong>{" "}
              Open{" "}
              <Link href="/servers" className="text-accent-strong underline">
                Servers
              </Link>
              . Caesar (or the target box) must be active with free slots. If
              every box is full, bring a new host online before queuing.
            </li>
            <li>
              <strong className="font-semibold">Collect customer inputs.</strong>{" "}
              You need: trading name, public domain, billing plan, admin email,
              and any payment/shipping/SMTP credentials they already have. You
              do <em>not</em> need AUTH_SECRET / STORE_ADMIN_SECRET / FLEET_SECRET
              — the worker generates those.
            </li>
            <li>
              <strong className="font-semibold">Open New tenant.</strong>{" "}
              <Link href="/tenants/new" className="text-accent-strong underline">
                /tenants/new
              </Link>{" "}
              (super-admin). Fill identity → target server → admin → optional
              MySQL overrides → external secrets.
            </li>
            <li>
              <strong className="font-semibold">Pick billing plan + platform tier.</strong>{" "}
              Plan = what they pay (Starter / Online / Retail / Sites). Tier =
              feature pack (online or retail). Tier defaults from the plan;
              override only when needed.
            </li>
            <li>
              <strong className="font-semibold">MySQL port is shared.</strong> Leave{" "}
              <span className="font-mono text-[12px]">3306</span> unless this
              host was deliberately set up otherwise. Every tenant on the box
              uses the same MySQL port; only the database name changes.
            </li>
            <li>
              <strong className="font-semibold">Queue provision.</strong> Watch the
              status page until <span className="font-mono text-[12px]">succeeded</span>.
              Only that box’s worker (matching{" "}
              <span className="font-mono text-[12px]">MERCATA_SERVER_ID</span>)
              claims the job.
            </li>
            <li>
              <strong className="font-semibold">DNS + smoke.</strong> Point the
              domain at the IP shown on success. Hit{" "}
              <span className="font-mono text-[12px]">https://&lt;domain&gt;/api/health</span>.
              Sign in to Store Management and finish branding / catalog (Excel
              onboard is manual when needed).
            </li>
            <li>
              <strong className="font-semibold">Secrets left blank?</strong> Fill
              them later in the tenant{" "}
              <span className="font-mono text-[12px]">.env</span> on the host or
              via Store Management — checkout / mail / shipping will stay
              partial until then.
            </li>
          </ol>

          <div className="mt-4 rounded-[4px] border border-border bg-background px-3 py-2 text-[12px] text-muted">
            Billing-only CRM row with no containers: use{" "}
            <Link href="/tenants/prospect" className="text-accent-strong underline">
              New prospect
            </Link>{" "}
            instead of provision.
          </div>
        </section>

        <section
          id="fields"
          className="scroll-mt-4 space-y-4 rounded-[4px] border border-border bg-surface p-4"
        >
          <div>
            <h2 className="text-[15px] font-semibold tracking-tight">
              Field examples
            </h2>
            <p className="mt-1 text-[13px] text-muted">
              Examples are fictional. Never paste production secrets into chat
              or tickets — only into the encrypted provision form or the host{" "}
              <span className="font-mono text-[12px]">.env</span>.
            </p>
          </div>

          <FieldTable title="Identity" rows={IDENTITY_FIELDS} />
          <FieldTable title="Target server" rows={SERVER_FIELDS} />
          <FieldTable title="Admin account" rows={ADMIN_FIELDS} />
          <FieldTable title="MySQL (tenant DB)" rows={MYSQL_FIELDS} />
          <FieldTable title="PayFast" rows={PAYFAST_FIELDS} />
          <FieldTable title="ShipLogic / PUDO" rows={SHIP_FIELDS} />
          <FieldTable title="SMTP" rows={SMTP_FIELDS} />
          <FieldTable title="Auto-generated on the host" rows={AUTO_FIELDS} />
        </section>

        <section
          id="after"
          className="scroll-mt-4 rounded-[4px] border border-border bg-surface p-4"
        >
          <h2 className="text-[15px] font-semibold tracking-tight">
            After provision succeeds
          </h2>
          <ul className="mt-3 list-disc space-y-2 pl-5 text-[13px] leading-relaxed">
            <li>
              DNS: A/AAAA for apex and www (if both are used) → the target
              server’s <span className="font-mono text-[12px]">public_ip</span>.
            </li>
            <li>
              Caddy on that host already has the site block from{" "}
              <span className="font-mono text-[12px]">fleet:generate</span> —
              do not add the hostname to another box’s Caddyfile.
            </li>
            <li>
              CRM: tenant is active on the chosen server with the selected
              billing plan. Invoices / digests follow normal Control flows.
            </li>
            <li>
              Failed job: use Retry on the status page (idempotent). Fix the
              underlying error (DB, compose, secrets) first.
            </li>
            <li>
              Smoke cleanup: if you provisioned a throwaway slug, remove the
              compose service, drop the DB, offboard the CRM row, and delete
              the DNS record.
            </li>
          </ul>
          <p className="mt-4 text-[13px]">
            <Link
              href="/tenants/new"
              className="font-semibold text-accent-strong underline"
            >
              Open New tenant →
            </Link>
          </p>
        </section>
      </main>
    </>
  );
}

function FieldTable({ title, rows }: { title: string; rows: FieldRow[] }) {
  return (
    <div>
      <h3 className="mb-2 text-[12px] font-semibold tracking-wide text-muted uppercase">
        {title}
      </h3>
      <div className="overflow-x-auto rounded-[4px] border border-border">
        <table className="w-full min-w-[36rem] border-collapse text-left text-[12px]">
          <thead className="bg-background text-[11px] tracking-wide text-muted uppercase">
            <tr>
              <th className="px-3 py-2 font-semibold">Field</th>
              <th className="px-3 py-2 font-semibold">Req</th>
              <th className="px-3 py-2 font-semibold">Example</th>
              <th className="px-3 py-2 font-semibold">Notes</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.field} className="border-t border-border align-top">
                <td className="px-3 py-2 font-medium text-foreground">
                  {row.field}
                </td>
                <td className="px-3 py-2 text-muted">
                  {row.required ? "Yes" : "No"}
                </td>
                <td className="px-3 py-2 font-mono text-[11px] text-foreground">
                  {row.example}
                </td>
                <td className="px-3 py-2 text-muted">{row.notes}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
