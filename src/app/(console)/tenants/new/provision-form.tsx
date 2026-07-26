"use client";

import Link from "next/link";
import { useActionState, useEffect, useMemo, useState } from "react";
import {
  enqueueProvisionJobAction,
  type ProvisionActionState,
} from "@/app/(console)/tenants/provision-actions";
import type { ServerFillOption } from "@/lib/servers/assign";
import { platformTierForPlan } from "@/lib/plans/tier-map";
import { formatZAR } from "@/lib/money";

const initial: ProvisionActionState = {};

export type PlanOption = {
  code: string;
  name: string;
  monthly_cents: number;
  product_line: string;
};

function generateStrongPassword(): string {
  const alphabet =
    "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!@#$%";
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  let out = "";
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return out;
}

export function ProvisionTenantForm({
  servers,
  autoPickId,
  plans,
}: {
  servers: ServerFillOption[];
  autoPickId: number | null;
  plans: PlanOption[];
}) {
  const [state, formAction, pending] = useActionState(
    enqueueProvisionJobAction,
    initial,
  );
  const [tenantId, setTenantId] = useState("");
  const [domain, setDomain] = useState("");
  const [dbName, setDbName] = useState("");
  const [dbTouched, setDbTouched] = useState(false);
  const [adminEmail, setAdminEmail] = useState("");
  const [emailTouched, setEmailTouched] = useState(false);
  const [adminPassword, setAdminPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [targetSelection, setTargetSelection] = useState<string>("auto");
  const [forceOverCapacity, setForceOverCapacity] = useState(false);
  const [planCode, setPlanCode] = useState(plans[0]?.code ?? "online");
  const [tierOverride, setTierOverride] = useState(false);
  const [tier, setTier] = useState<"online" | "retail">(
    platformTierForPlan(plans[0]?.code ?? "online"),
  );

  const activeServers = useMemo(
    () => servers.filter((s) => s.active && s.capacity > 0),
    [servers],
  );
  const allFull =
    activeServers.length === 0 ||
    activeServers.every((s) => s.tenantCount >= s.capacity);
  const autoLabel = useMemo(() => {
    if (!autoPickId) return "AUTO — no under-capacity server";
    const s = servers.find((x) => x.id === autoPickId);
    if (!s) return "AUTO";
    return `AUTO — ${s.name} (${s.tenantCount}/${s.capacity}, ${s.remaining} free)`;
  }, [autoPickId, servers]);

  const selectedFull = useMemo(() => {
    if (targetSelection === "auto") return allFull;
    const s = servers.find((x) => String(x.id) === targetSelection);
    return s ? s.tenantCount >= s.capacity : false;
  }, [targetSelection, servers, allFull]);

  const blockSubmit = selectedFull && !forceOverCapacity;

  const suggestedDb = useMemo(() => {
    const slug = tenantId.trim().toLowerCase().replace(/[^a-z0-9-]/g, "");
    if (!slug) return "";
    return `storedb_${slug.replace(/-/g, "_")}`;
  }, [tenantId]);

  const suggestedEmail = useMemo(() => {
    const d = domain
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\//, "")
      .replace(/\/$/, "");
    return d ? `admin@${d}` : "";
  }, [domain]);

  useEffect(() => {
    if (!dbTouched) setDbName(suggestedDb);
  }, [suggestedDb, dbTouched]);

  useEffect(() => {
    if (!emailTouched) setAdminEmail(suggestedEmail);
  }, [suggestedEmail, emailTouched]);

  useEffect(() => {
    if (!tierOverride) setTier(platformTierForPlan(planCode));
  }, [planCode, tierOverride]);

  return (
    <form action={formAction} className="max-w-2xl space-y-5" autoComplete="off">
      <section className="rounded-[4px] border border-border bg-surface p-4">
        <h2 className="mb-3 text-[13px] font-semibold">Identity</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-semibold tracking-wide text-muted uppercase">
              Tenant id / slug
            </span>
            <input
              name="tenant_id"
              required
              value={tenantId}
              onChange={(e) => setTenantId(e.target.value.toLowerCase())}
              pattern="[a-z][a-z0-9-]{0,31}"
              className="h-9 rounded-[4px] border border-border bg-surface px-3 font-mono text-[13px]"
              placeholder="acme"
            />
            <span className="text-[11px] text-muted">
              lowercase letter, then [a-z0-9-] · becomes TENANT_ID
            </span>
          </label>
          <Field label="Display name" name="display_name" required />
          <label className="flex flex-col gap-1 sm:col-span-2">
            <span className="text-[11px] font-semibold tracking-wide text-muted uppercase">
              Domain
            </span>
            <input
              name="domain"
              required
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              className="h-9 rounded-[4px] border border-border bg-surface px-3 font-mono text-[13px]"
              placeholder="shop.acme.co.za"
            />
            <span className="text-[11px] text-muted">
              Sets AUTH_URL / NEXTAUTH_URL / NEXT_PUBLIC_APP_URL to https://…
            </span>
          </label>
          <label className="flex flex-col gap-1 sm:col-span-2">
            <span className="text-[11px] font-semibold tracking-wide text-muted uppercase">
              Billing plan
            </span>
            <select
              name="plan_code"
              required
              value={planCode}
              onChange={(e) => setPlanCode(e.target.value)}
              className="h-9 rounded-[4px] border border-border bg-surface px-3 text-[13px]"
            >
              {plans.map((p) => (
                <option key={p.code} value={p.code}>
                  {p.name} — {formatZAR(p.monthly_cents)}/mo
                  {p.product_line === "sites" ? " (sites)" : ""}
                </option>
              ))}
            </select>
            <span className="text-[11px] text-muted">
              All active catalog plans. CRM subscription is created on success.
            </span>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-semibold tracking-wide text-muted uppercase">
              Platform tier (features)
            </span>
            <select
              name="tier"
              required
              value={tier}
              onChange={(e) => {
                setTierOverride(true);
                setTier(e.target.value as "online" | "retail");
              }}
              className="h-9 rounded-[4px] border border-border bg-surface px-3 text-[13px]"
            >
              <option value="online">Online — shop / cart / checkout</option>
              <option value="retail">Retail — online + POS / stock take</option>
            </select>
            <span className="text-[11px] text-muted">
              Storefront feature set (TENANT_TIER). Defaults from billing plan;
              override if needed.
            </span>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-semibold tracking-wide text-muted uppercase">
              DB name
            </span>
            <input
              name="db_name"
              required
              value={dbName}
              onChange={(e) => {
                setDbTouched(true);
                setDbName(e.target.value);
              }}
              pattern="[A-Za-z0-9_]{1,64}"
              className="h-9 rounded-[4px] border border-border bg-surface px-3 font-mono text-[13px]"
            />
            <span className="text-[11px] text-muted">
              MYSQL_DATABASE · auto storedb_&lt;id&gt;
            </span>
          </label>
        </div>
      </section>

      <section className="rounded-[4px] border border-border bg-surface p-4">
        <h2 className="mb-1 text-[13px] font-semibold">Target server</h2>
        <p className="mb-3 text-[12px] text-muted">
          AUTO picks the active box with the most free capacity under its
          ceiling. Override only when you need a specific host.
        </p>

        {activeServers.length === 0 ? (
          <p className="mb-3 rounded-[4px] border border-status-error/30 bg-status-error/8 px-3 py-2 text-[12px] text-status-error">
            No active servers with capacity. Register one under{" "}
            <Link href="/servers" className="underline">
              /servers
            </Link>{" "}
            before provisioning.
          </p>
        ) : null}

        {allFull && activeServers.length > 0 ? (
          <p className="mb-3 rounded-[4px] border border-status-warn/40 bg-status-warn/10 px-3 py-2 text-[12px] text-foreground">
            All servers are at or over capacity. Provision a new box first —
            or choose a server and confirm force override below.
          </p>
        ) : null}

        <ul className="mb-3 space-y-1.5">
          {activeServers.map((s) => {
            const full = s.tenantCount >= s.capacity;
            const isAuto = autoPickId === s.id;
            return (
              <li
                key={s.id}
                className="flex flex-wrap items-baseline justify-between gap-2 rounded-[4px] border border-border px-3 py-2 text-[12px]"
              >
                <span>
                  <span className="font-mono font-semibold">{s.name}</span>
                  {s.label ? (
                    <span className="text-muted"> — {s.label}</span>
                  ) : null}
                  {isAuto ? (
                    <span className="ml-2 text-[11px] font-semibold text-accent-strong">
                      AUTO pick
                    </span>
                  ) : null}
                  {full ? (
                    <span className="ml-2 text-[11px] font-semibold text-status-error">
                      FULL
                    </span>
                  ) : null}
                </span>
                <span className="font-mono tabular-nums text-muted">
                  {s.tenantCount}/{s.capacity}
                  {s.publicIp ? ` · ${s.publicIp}` : ""}
                </span>
              </li>
            );
          })}
        </ul>

        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-semibold tracking-wide text-muted uppercase">
            Assign to
          </span>
          <select
            name="target_server"
            required
            value={targetSelection}
            onChange={(e) => setTargetSelection(e.target.value)}
            className="h-9 rounded-[4px] border border-border bg-surface px-3 text-[13px]"
          >
            <option value="auto">{autoLabel}</option>
            {activeServers.map((s) => (
              <option key={s.id} value={String(s.id)}>
                {s.name} — {s.tenantCount}/{s.capacity}
                {s.tenantCount >= s.capacity
                  ? " (full)"
                  : ` (${s.remaining} free)`}
              </option>
            ))}
          </select>
        </label>

        {selectedFull ? (
          <label className="mt-3 flex items-start gap-2 text-[12px]">
            <input
              type="checkbox"
              name="force_over_capacity"
              checked={forceOverCapacity}
              onChange={(e) => setForceOverCapacity(e.target.checked)}
              className="mt-0.5"
            />
            <span>
              Force override — place on a full server anyway (only when you
              accept over-capacity risk). Prefer provisioning a new server.
            </span>
          </label>
        ) : null}
      </section>

      <section className="rounded-[4px] border border-border bg-surface p-4">
        <h2 className="mb-3 text-[13px] font-semibold">Admin account</h2>
        <p className="mb-3 text-[12px] text-muted">
          Storefront admin user created during provision. Password is encrypted
          for one-time hand-off — never stored in plaintext and never shown
          again after submit.
        </p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 sm:col-span-2">
            <span className="text-[11px] font-semibold tracking-wide text-muted uppercase">
              Admin email
            </span>
            <input
              name="admin_email"
              type="email"
              required
              value={adminEmail}
              onChange={(e) => {
                setEmailTouched(true);
                setAdminEmail(e.target.value);
              }}
              className="h-9 rounded-[4px] border border-border bg-surface px-3 text-[13px]"
            />
          </label>
          <label className="flex flex-col gap-1 sm:col-span-2">
            <span className="text-[11px] font-semibold tracking-wide text-muted uppercase">
              Admin password
            </span>
            <div className="flex gap-2">
              <input
                name="admin_password"
                type={showPw ? "text" : "password"}
                required
                minLength={12}
                value={adminPassword}
                onChange={(e) => setAdminPassword(e.target.value)}
                autoComplete="new-password"
                className="h-9 flex-1 rounded-[4px] border border-border bg-surface px-3 font-mono text-[13px]"
              />
              <button
                type="button"
                onClick={() => setAdminPassword(generateStrongPassword())}
                className="h-9 shrink-0 rounded-[4px] border border-border px-3 text-[12px] font-semibold hover:bg-background"
              >
                Generate strong
              </button>
              <button
                type="button"
                onClick={() => setShowPw((v) => !v)}
                className="h-9 shrink-0 rounded-[4px] border border-border px-3 text-[12px] hover:bg-background"
              >
                {showPw ? "Hide" : "Show"}
              </button>
            </div>
          </label>
        </div>
      </section>

      <section className="rounded-[4px] border border-border bg-surface p-4">
        <h2 className="mb-1 text-[13px] font-semibold">MySQL (tenant DB)</h2>
        <p className="mb-3 text-[12px] text-muted">
          All tenants on a host share the same MySQL instance and port (
          <span className="font-mono">3306</span>). Only database name / user
          differ. Leave blanks to use host defaults (
          <span className="font-mono">host.docker.internal:3306</span> +
          provision worker root creds).
        </p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field
            label="MYSQL_HOST"
            name="mysql_host"
            mono
            placeholder="host.docker.internal"
          />
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-semibold tracking-wide text-muted uppercase">
              MYSQL_PORT
            </span>
            <input
              name="mysql_port"
              defaultValue="3306"
              inputMode="numeric"
              pattern="[0-9]{2,5}"
              className="h-9 rounded-[4px] border border-border bg-surface px-3 font-mono text-[13px]"
            />
            <span className="text-[11px] text-muted">
              Same for every tenant on this box
            </span>
          </label>
          <Field label="MYSQL_USER" name="mysql_user" mono placeholder="root" />
          <Field
            label="MYSQL_PASSWORD"
            name="mysql_password"
            type="password"
          />
        </div>
      </section>

      <section className="rounded-[4px] border border-status-warn/40 bg-status-warn/8 p-4">
        <h2 className="mb-1 text-[13px] font-semibold">External secrets</h2>
        <p className="mb-3 text-[12px] text-foreground/80">
          Written only to the tenant{" "}
          <code className="font-mono text-[11px]">.env</code> on the host after
          decrypt. Leave blank to fill later in Store Management. Never stored
          in plaintext in Control.
        </p>

        <h3 className="mb-2 text-[12px] font-semibold text-muted uppercase tracking-wide">
          PayFast
        </h3>
        <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="PAYFAST_MERCHANT_ID" name="payfast_merchant_id" mono />
          <Field label="PAYFAST_MERCHANT_KEY" name="payfast_merchant_key" mono />
          <Field
            label="PAYFAST_PASSPHRASE"
            name="payfast_passphrase"
            type="password"
            className="sm:col-span-2"
          />
          <label className="flex items-center gap-2 text-[13px] sm:col-span-2">
            <input type="checkbox" name="payfast_sandbox" />
            Sandbox mode
          </label>
        </div>

        <h3 className="mb-2 text-[12px] font-semibold text-muted uppercase tracking-wide">
          ShipLogic / Courier Guy
        </h3>
        <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="SHIPLOGIC_BASE_URL" name="shiplogic_base_url" mono />
          <Field
            label="SHIPLOGIC_API_KEY"
            name="shiplogic_api_key"
            type="password"
          />
          <label className="flex flex-col gap-1 sm:col-span-2">
            <span className="text-[11px] font-semibold tracking-wide text-muted uppercase">
              Collection JSON
            </span>
            <textarea
              name="shiplogic_collection_json"
              rows={3}
              className="rounded-[4px] border border-border bg-surface px-3 py-2 font-mono text-[12px]"
              placeholder='{"street_address":"…","local_area":"…","city":"…","code":"…"}'
            />
          </label>
          <label className="flex items-center gap-2 text-[13px] sm:col-span-2">
            <input type="checkbox" name="shiplogic_sandbox" />
            Sandbox mode
          </label>
        </div>

        <h3 className="mb-2 text-[12px] font-semibold text-muted uppercase tracking-wide">
          PUDO / TCG Locker
        </h3>
        <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field
            label="TCG_LOCKER_API_KEY"
            name="tcg_locker_api_key"
            type="password"
          />
          <Field
            label="PUDO shipping amount (ZAR)"
            name="pudo_shipping_amount"
            mono
            placeholder="65.00"
          />
        </div>

        <h3 className="mb-2 text-[12px] font-semibold text-muted uppercase tracking-wide">
          SMTP (Resend / other)
        </h3>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field
            label="SMTP_HOST"
            name="smtp_host"
            mono
            placeholder="smtp.resend.com"
          />
          <Field
            label="SMTP_PORT"
            name="smtp_port"
            mono
            placeholder="465"
            defaultValue="465"
          />
          <Field
            label="SMTP_USER"
            name="smtp_user"
            mono
            placeholder="resend"
          />
          <Field label="SMTP_PASS" name="smtp_pass" type="password" />
        </div>
      </section>

      <section className="rounded-[4px] border border-border bg-background p-4">
        <h2 className="mb-2 text-[13px] font-semibold">Auto-generated on host</h2>
        <p className="text-[12px] text-muted">
          Not collected here (worker generates with openssl):{" "}
          <span className="font-mono">AUTH_SECRET</span>,{" "}
          <span className="font-mono">STORE_ADMIN_SECRET</span>,{" "}
          <span className="font-mono">FLEET_SECRET</span>. Also set from
          identity:{" "}
          <span className="font-mono">TENANT_ID</span>,{" "}
          <span className="font-mono">TENANT_TIER</span>,{" "}
          <span className="font-mono">TENANT_FEATURES</span>,{" "}
          <span className="font-mono">AUTH_URL</span> /{" "}
          <span className="font-mono">NEXTAUTH_URL</span> /{" "}
          <span className="font-mono">NEXT_PUBLIC_APP_URL</span>.
        </p>
      </section>

      {state.error ? (
        <p className="rounded-[4px] border border-status-error/30 bg-status-error/8 px-3 py-2 text-[12px] text-status-error">
          {state.error}
        </p>
      ) : null}

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={
            pending ||
            !adminPassword ||
            blockSubmit ||
            activeServers.length === 0 ||
            plans.length === 0
          }
          className="h-9 rounded-[4px] bg-accent-strong px-4 text-[13px] font-semibold text-white disabled:opacity-60"
        >
          {pending ? "Queuing…" : "Queue provision"}
        </button>
        <Link
          href="/tenants"
          className="text-[13px] text-muted hover:text-foreground"
        >
          Cancel
        </Link>
      </div>
    </form>
  );
}

function Field({
  label,
  name,
  required,
  type = "text",
  mono,
  placeholder,
  defaultValue,
  className = "",
}: {
  label: string;
  name: string;
  required?: boolean;
  type?: string;
  mono?: boolean;
  placeholder?: string;
  defaultValue?: string;
  className?: string;
}) {
  return (
    <label className={`flex flex-col gap-1 ${className}`}>
      <span className="text-[11px] font-semibold tracking-wide text-muted uppercase">
        {label}
      </span>
      <input
        name={name}
        type={type}
        required={required}
        placeholder={placeholder}
        defaultValue={defaultValue}
        autoComplete="off"
        className={`h-9 rounded-[4px] border border-border bg-surface px-3 text-[13px] outline-none focus:border-accent-strong ${mono ? "font-mono" : ""}`}
      />
    </label>
  );
}
