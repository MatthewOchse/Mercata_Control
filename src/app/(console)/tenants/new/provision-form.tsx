"use client";

import Link from "next/link";
import { useActionState, useEffect, useMemo, useState } from "react";
import {
  enqueueProvisionJobAction,
  type ProvisionActionState,
} from "@/app/(console)/tenants/provision-actions";
import type { ServerFillOption } from "@/lib/servers/assign";

const initial: ProvisionActionState = {};

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
}: {
  servers: ServerFillOption[];
  autoPickId: number | null;
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
              lowercase letter, then [a-z0-9-]
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
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-semibold tracking-wide text-muted uppercase">
              Tier
            </span>
            <select
              name="tier"
              required
              defaultValue="online"
              className="h-9 rounded-[4px] border border-border bg-surface px-3 text-[13px]"
            >
              <option value="online">Online</option>
              <option value="retail">Retail</option>
            </select>
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
              Auto-suggests storedb_&lt;id&gt;
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
          for one-time hand-off to the host worker — never stored in plaintext
          and never shown again after submit.
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

      <section className="rounded-[4px] border border-status-warn/40 bg-status-warn/8 p-4">
        <h2 className="mb-1 text-[13px] font-semibold">External secrets</h2>
        <p className="mb-3 text-[12px] text-foreground/80">
          Optional now — can be filled later in Store Management / the tenant{" "}
          <code className="font-mono text-[11px]">.env</code>. These values are
          written <strong>only</strong> to the tenant&apos;s{" "}
          <code className="font-mono text-[11px]">.env</code> on the host after
          decrypt. They are never stored in plaintext in the admin database.
        </p>

        <h3 className="mb-2 text-[12px] font-semibold text-muted uppercase tracking-wide">
          Database (if not using host defaults)
        </h3>
        <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="MySQL host" name="mysql_host" mono />
          <Field label="MySQL port" name="mysql_port" mono placeholder="3306" />
          <Field label="MySQL user" name="mysql_user" mono />
          <Field label="MySQL password" name="mysql_password" type="password" />
        </div>

        <h3 className="mb-2 text-[12px] font-semibold text-muted uppercase tracking-wide">
          PayFast
        </h3>
        <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Merchant id" name="payfast_merchant_id" mono />
          <Field label="Merchant key" name="payfast_merchant_key" mono />
          <Field
            label="Passphrase"
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
          <Field label="Base URL" name="shiplogic_base_url" mono />
          <Field label="API key" name="shiplogic_api_key" type="password" />
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
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
      </section>

      <p className="text-[12px] text-muted">
        Internal secrets (AUTH_SECRET, STORE_ADMIN_SECRET, FLEET_SECRET) are{" "}
        <strong>not</strong> collected here — the target host worker generates
        them with openssl.
      </p>

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
            activeServers.length === 0
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
  className = "",
}: {
  label: string;
  name: string;
  required?: boolean;
  type?: string;
  mono?: boolean;
  placeholder?: string;
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
        autoComplete="off"
        className={`h-9 rounded-[4px] border border-border bg-surface px-3 text-[13px] outline-none focus:border-accent-strong ${mono ? "font-mono" : ""}`}
      />
    </label>
  );
}
