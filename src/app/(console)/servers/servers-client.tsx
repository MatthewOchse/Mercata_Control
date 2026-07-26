"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { Money, StatusPill } from "@/components/ui/status";
import {
  CAPACITY_WARN_PCT,
  DEFAULT_SERVER_CAPACITY,
} from "@/lib/servers/constants";
import type { ServerCapacity } from "@/lib/servers/queries";
import { upsertServerAction, type ServerActionState } from "./actions";

const empty: ServerActionState = {};

function CapacityBar({ pct, tone }: { pct: number; tone: ServerCapacity["tone"] }) {
  const barColor =
    tone === "error"
      ? "bg-status-error"
      : tone === "warn"
        ? "bg-status-warn"
        : "bg-status-ok";
  return (
    <div
      className="h-2 w-full overflow-hidden rounded-[2px] border border-border bg-background"
      role="img"
      aria-label={`${pct}% of capacity used`}
    >
      <div
        className={`h-full ${barColor}`}
        style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
      />
    </div>
  );
}

export function ServersClient({ servers }: { servers: ServerCapacity[] }) {
  const [state, action, pending] = useActionState(upsertServerAction, empty);
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const overWarn = servers.filter((s) => s.tone !== "ok");

  return (
    <div className="space-y-5">
      <section className="rounded-[4px] border border-border bg-surface p-4">
        <h2 className="text-[13px] font-semibold">Capacity</h2>
        <p className="mt-1 text-[12px] text-muted">
          Each box has a tenant ceiling. Once a server passes{" "}
          {CAPACITY_WARN_PCT}% it is flagged here so the next one is provisioned
          before it is urgent. This is awareness only — nothing is provisioned or
          moved automatically.
        </p>
        {overWarn.length > 0 ? (
          <p className="mt-2 text-[12px] font-medium text-status-warn">
            {overWarn.length} server(s) need attention:{" "}
            {overWarn.map((s) => s.name).join(", ")}
          </p>
        ) : (
          <p className="mt-2 text-[12px] text-status-ok">
            All servers comfortably under {CAPACITY_WARN_PCT}%.
          </p>
        )}
      </section>

      {state.error ? (
        <div className="rounded-[4px] border border-status-error bg-status-error/10 p-3 text-[13px] text-status-error">
          {state.error}
        </div>
      ) : null}
      {state.message ? (
        <div className="rounded-[4px] border border-status-ok bg-status-ok/10 p-3 text-[13px] text-status-ok">
          {state.message}
        </div>
      ) : null}

      <div className="space-y-4">
        {servers.map((s) => (
          <section
            key={s.name}
            className="rounded-[4px] border border-border bg-surface p-4"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="font-mono text-[14px] font-semibold">
                    {s.name}
                  </h3>
                  <StatusPill
                    tone={s.tone}
                    label={
                      s.capacity === 0
                        ? "No ceiling set"
                        : s.tone === "error"
                          ? "Full"
                          : s.tone === "warn"
                            ? "Filling up"
                            : "Healthy"
                    }
                  />
                  {!s.active ? (
                    <StatusPill tone="idle" label="Retired" />
                  ) : null}
                </div>
                {s.label ? (
                  <p className="mt-0.5 text-[12px] text-muted">{s.label}</p>
                ) : null}
              </div>
              <div className="text-right">
                <div className="text-[17px] font-semibold tabular-nums">
                  {s.tenantCount}
                  {s.capacity > 0 ? (
                    <span className="text-muted"> / {s.capacity}</span>
                  ) : null}
                </div>
                <div className="text-[11px] text-muted">
                  {s.capacity > 0
                    ? `${s.usedPct}% used · ${s.remaining} slot(s) free`
                    : "register a ceiling to track this box"}
                </div>
              </div>
            </div>

            {s.capacity > 0 ? (
              <div className="mt-3">
                <CapacityBar pct={s.usedPct} tone={s.tone} />
              </div>
            ) : null}

            {s.notes ? (
              <p className="mt-2 text-[12px] text-muted">{s.notes}</p>
            ) : null}

            {s.tenants.length > 0 ? (
              <table className="admin-table mt-3">
                <thead>
                  <tr>
                    <th>Tenant</th>
                    <th>Plan</th>
                    <th className="text-right">MRR</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {s.tenants.map((t) => (
                    <tr key={t.id}>
                      <td>
                        <Link
                          href={`/tenants/${t.slug}`}
                          className="font-medium hover:text-accent-strong"
                        >
                          {t.tradingName}
                        </Link>
                      </td>
                      <td className="text-[12px]">{t.planName ?? "—"}</td>
                      <td className="text-right">
                        <Money cents={t.mrrCents} className="text-[12px]" />
                      </td>
                      <td className="text-[12px]">{t.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="mt-3 text-[12px] text-muted">
                No tenants assigned to this box.
              </p>
            )}

            <button
              type="button"
              onClick={() => setEditing(editing === s.name ? null : s.name)}
              className="mt-3 text-[12px] font-semibold text-accent-strong hover:underline"
            >
              {editing === s.name ? "Close" : "Edit ceiling"}
            </button>

            {editing === s.name ? (
              <ServerForm
                action={action}
                pending={pending}
                defaults={{
                  name: s.name,
                  label: s.label ?? "",
                  capacity: s.capacity || DEFAULT_SERVER_CAPACITY,
                  notes: s.notes ?? "",
                  active: s.active,
                }}
                lockName
              />
            ) : null}
          </section>
        ))}
      </div>

      <section className="rounded-[4px] border border-border bg-surface p-4">
        <button
          type="button"
          onClick={() => setAdding((v) => !v)}
          className="text-[13px] font-semibold text-accent-strong hover:underline"
        >
          {adding ? "Cancel" : "Register another server"}
        </button>
        {adding ? (
          <ServerForm
            action={action}
            pending={pending}
            defaults={{
              name: "",
              label: "",
              capacity: DEFAULT_SERVER_CAPACITY,
              notes: "",
              active: true,
            }}
          />
        ) : null}
      </section>
    </div>
  );
}

function ServerForm({
  action,
  pending,
  defaults,
  lockName,
}: {
  action: (formData: FormData) => void;
  pending: boolean;
  defaults: {
    name: string;
    label: string;
    capacity: number;
    notes: string;
    active: boolean;
  };
  lockName?: boolean;
}) {
  return (
    <form action={action} className="mt-3 flex flex-wrap items-end gap-3">
      <label className="flex w-[10rem] flex-col gap-1 text-[12px]">
        <span className="text-muted uppercase">Name</span>
        <input
          name="name"
          defaultValue={defaults.name}
          readOnly={lockName}
          required
          placeholder="e.g. brutus"
          className="h-8 rounded-[4px] border border-border px-2 font-mono text-[13px] read-only:bg-background read-only:text-muted"
        />
      </label>
      <label className="flex min-w-[12rem] flex-1 flex-col gap-1 text-[12px]">
        <span className="text-muted uppercase">Label</span>
        <input
          name="label"
          defaultValue={defaults.label}
          placeholder="Optional description"
          className="h-8 rounded-[4px] border border-border px-2 text-[13px]"
        />
      </label>
      <label className="flex w-[8rem] flex-col gap-1 text-[12px]">
        <span className="text-muted uppercase">Ceiling</span>
        <input
          name="capacity"
          type="number"
          min={1}
          defaultValue={defaults.capacity}
          required
          className="h-8 rounded-[4px] border border-border px-2 text-right font-mono text-[13px]"
        />
      </label>
      <label className="flex min-w-[12rem] flex-1 flex-col gap-1 text-[12px]">
        <span className="text-muted uppercase">Notes</span>
        <input
          name="notes"
          defaultValue={defaults.notes}
          className="h-8 rounded-[4px] border border-border px-2 text-[13px]"
        />
      </label>
      <label className="flex items-center gap-2 text-[12px]">
        <input type="checkbox" name="active" defaultChecked={defaults.active} />
        <span>In service</span>
      </label>
      <button
        type="submit"
        disabled={pending}
        className="h-8 rounded-[4px] bg-accent-strong px-3 text-[12px] font-semibold text-white hover:bg-primary disabled:opacity-50"
      >
        {pending ? "Saving…" : "Save"}
      </button>
    </form>
  );
}
