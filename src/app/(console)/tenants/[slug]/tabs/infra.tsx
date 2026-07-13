"use client";

import { useState, useTransition } from "react";
import { regenerateSecretAction } from "@/app/(console)/tenants/actions";
import type { InfraRecord, TenantStatus } from "@/lib/tenants/types";

export function InfraTab({
  slug,
  infra,
  status,
}: {
  slug: string;
  infra: InfraRecord | null;
  status: TenantStatus;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [newSecret, setNewSecret] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);

  if (!infra) {
    return <p className="text-[13px] text-muted">No infra record</p>;
  }

  return (
    <div className="max-w-2xl space-y-4">
      <section className="rounded-[4px] border border-border bg-surface p-4">
        <h3 className="mb-3 text-[12px] font-semibold tracking-wide text-muted uppercase">
          Domains &amp; containers
        </h3>
        <dl className="grid grid-cols-[140px_1fr] gap-y-2 text-[13px]">
          <dt className="text-muted">Primary domain</dt>
          <dd className="font-mono text-[12px]">{infra.primary_domain}</dd>
          <dt className="text-muted">Extra domains</dt>
          <dd className="font-mono text-[12px]">
            {infra.extra_domains?.length
              ? infra.extra_domains.join(", ")
              : "—"}
          </dd>
          <dt className="text-muted">Container</dt>
          <dd className="font-mono text-[12px]">{infra.container_name}</dd>
          <dt className="text-muted">Database</dt>
          <dd className="font-mono text-[12px]">{infra.db_name}</dd>
          <dt className="text-muted">Host</dt>
          <dd className="font-mono text-[12px]">{infra.host}</dd>
          <dt className="text-muted">Health path</dt>
          <dd className="font-mono text-[12px]">{infra.health_path}</dd>
        </dl>
      </section>

      <section className="rounded-[4px] border border-border bg-surface p-4">
        <h3 className="mb-3 text-[12px] font-semibold tracking-wide text-muted uppercase">
          Fleet secret
        </h3>
        <p className="mb-2 font-mono text-[13px] text-muted">
          {"•".repeat(24)}…
        </p>
        <p className="mb-3 text-[12px] text-muted">
          Stored encrypted at rest. Plaintext is only shown once after
          regenerate.
        </p>

        {status !== "offboarded" ? (
          confirm ? (
            <div className="space-y-2">
              <p className="text-[12px] text-status-warn">
                Regenerating invalidates the previous secret. Update the tenant
                container after copying the new value.
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => {
                    setError(null);
                    startTransition(async () => {
                      const result = await regenerateSecretAction(slug);
                      if (result.error) setError(result.error);
                      else {
                        setNewSecret(result.plaintextSecret ?? null);
                        setConfirm(false);
                      }
                    });
                  }}
                  className="h-8 rounded-[4px] bg-accent-strong px-3 text-[12px] font-semibold text-white disabled:opacity-60"
                >
                  Confirm regenerate
                </button>
                <button
                  type="button"
                  onClick={() => setConfirm(false)}
                  className="h-8 rounded-[4px] border border-border px-3 text-[12px]"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirm(true)}
              className="h-8 rounded-[4px] border border-border px-3 text-[12px] font-medium hover:border-primary-light"
            >
              Regenerate
            </button>
          )
        ) : null}

        {error ? (
          <p className="mt-2 text-[12px] text-status-error">{error}</p>
        ) : null}
        {newSecret ? (
          <div className="mt-3 rounded-[4px] border border-status-ok/30 bg-status-ok/8 p-3">
            <p className="mb-1 text-[11px] font-semibold text-status-ok uppercase">
              New secret — copy now
            </p>
            <code className="block break-all font-mono text-[12px]">
              {newSecret}
            </code>
          </div>
        ) : null}
      </section>
    </div>
  );
}
