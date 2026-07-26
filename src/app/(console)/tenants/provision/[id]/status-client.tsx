"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, useTransition } from "react";
import type { ProvisioningJob } from "@/lib/provisioning/types";
import { StatusPill } from "@/components/ui/status";
import { retryProvisionJobAction } from "@/app/(console)/tenants/provision-actions";

function statusTone(
  status: ProvisioningJob["status"],
): "ok" | "warn" | "error" | "idle" {
  switch (status) {
    case "succeeded":
      return "ok";
    case "failed":
      return "error";
    case "running":
    case "awaiting_env":
      return "warn";
    default:
      return "idle";
  }
}

export function ProvisionJobStatusClient({
  initialJob,
  targetServer,
}: {
  initialJob: ProvisioningJob;
  targetServer: {
    id: number;
    name: string;
    publicIp: string | null;
  } | null;
}) {
  const [job, setJob] = useState(initialJob);
  const [retryError, setRetryError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const refresh = useCallback(async () => {
    const res = await fetch(`/api/admin/provisioning-jobs/${initialJob.id}`, {
      cache: "no-store",
    });
    if (!res.ok) return;
    const data = (await res.json()) as { job: ProvisioningJob };
    if (data.job) setJob(data.job);
  }, [initialJob.id]);

  useEffect(() => {
    const terminal =
      job.status === "succeeded" || job.status === "failed";
    if (terminal) return;
    const t = setInterval(() => {
      void refresh();
    }, 2000);
    return () => clearInterval(t);
  }, [job.status, refresh]);

  const domainHref = job.domain.includes("localhost")
    ? `http://${job.domain}`
    : `https://${job.domain}`;
  const brandingHref = `${domainHref}/admin/store-management/branding`;
  const onboardCmd = `npm run tenant:onboard -- ${job.tenant_id} --workbook ./client.xlsx`;
  const dnsIp = targetServer?.publicIp?.trim() || null;
  const serverLabel = targetServer
    ? `${targetServer.name} (#${targetServer.id})`
    : `server #${job.target_server_id}`;

  const failedStep = job.non_sensitive_config?.failedStep;
  const orphanNotes = job.non_sensitive_config?.orphanNotes;

  function onRetry() {
    setRetryError(null);
    startTransition(async () => {
      const res = await retryProvisionJobAction(job.id);
      if (res.error) {
        setRetryError(res.error);
        return;
      }
      await refresh();
    });
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <StatusPill tone={statusTone(job.status)} label={job.status} />
        <span className="font-mono text-[13px] text-foreground">
          {job.tenant_id}
        </span>
        <span className="text-[12px] text-muted">
          {job.tier} · {job.domain} · {job.db_name} · {serverLabel}
        </span>
      </div>

      {job.status === "succeeded" ? (
        <div className="space-y-3 rounded-[4px] border border-status-ok/30 bg-status-ok/8 p-4">
          <p className="text-[13px] font-semibold text-foreground">
            Provision succeeded on {serverLabel}
          </p>
          {dnsIp ? (
            <div className="rounded-[4px] border border-border bg-surface px-3 py-2 text-[12px]">
              <strong>DNS guidance:</strong> point A/AAAA for{" "}
              <code className="font-mono">{job.domain}</code> →{" "}
              <code className="font-mono">{dnsIp}</code>
              <span className="text-muted">
                {" "}
                (public IP of {targetServer?.name}, not a fixed Caesar address)
              </span>
            </div>
          ) : (
            <p className="text-[12px] text-status-warn">
              Target server has no public_ip set — add it under /servers for DNS
              guidance.
            </p>
          )}
          <p className="text-[12px] text-foreground/90">
            Automated steps are done. The next two runbook steps are{" "}
            <strong>manual</strong> — they are not run by the worker:
          </p>
          <ol className="list-decimal space-y-2 pl-5 text-[12px] text-foreground">
            <li>
              <strong>Brand the site</strong> (Store Management → Branding)
              <div className="mt-1">
                <a
                  href={brandingHref}
                  target="_blank"
                  rel="noreferrer"
                  className="font-semibold text-accent-strong underline"
                >
                  Open branding page
                </a>
              </div>
            </li>
            <li>
              <strong>Import Excel stock</strong> — explicit action, not
              auto-run:
              <pre className="mt-1 overflow-x-auto rounded-[4px] border border-border bg-surface px-2 py-1.5 font-mono text-[11px]">
                {onboardCmd}
              </pre>
              <span className="text-muted">
                Preview first; add <code className="font-mono">--commit</code>{" "}
                when ready.
              </span>
            </li>
          </ol>
          <div className="flex flex-wrap gap-3 pt-1">
            <a
              href={domainHref}
              target="_blank"
              rel="noreferrer"
              className="text-[13px] font-semibold text-accent-strong underline"
            >
              Open {job.domain}
            </a>
            <Link
              href="/tenants"
              className="text-[13px] text-muted hover:text-foreground"
            >
              Back to tenants
            </Link>
          </div>
        </div>
      ) : null}

      {job.status === "failed" ? (
        <div className="space-y-3 rounded-[4px] border border-status-error/30 bg-status-error/8 p-4">
          <p className="text-[13px] font-semibold text-status-error">
            Provision failed
            {failedStep ? (
              <>
                {" "}
                at step <span className="font-mono">{failedStep}</span>
              </>
            ) : null}
          </p>
          {orphanNotes ? (
            <div className="rounded-[4px] border border-status-warn/40 bg-status-warn/10 px-3 py-2 text-[12px] text-foreground">
              <strong>Orphans / manual attention:</strong> {orphanNotes}
            </div>
          ) : (
            <p className="text-[12px] text-muted">
              Check the log for MANUAL ATTENTION lines (DB/registry may remain).
            </p>
          )}
          <p className="text-[12px] text-muted">
            Retry re-queues this job idempotently (reuses existing DB/.env when
            present; will not create a duplicate id/domain job).
          </p>
          <button
            type="button"
            disabled={pending}
            onClick={onRetry}
            className="h-9 rounded-[4px] bg-accent-strong px-4 text-[13px] font-semibold text-white disabled:opacity-60"
          >
            {pending ? "Re-queuing…" : "Retry provision"}
          </button>
          {retryError ? (
            <p className="text-[12px] text-status-error">{retryError}</p>
          ) : null}
        </div>
      ) : null}

      {job.status === "queued" || job.status === "running" ? (
        <p className="text-[12px] text-muted">
          Live updating every 2s while the {targetServer?.name ?? "target"}{" "}
          worker processes this job…
        </p>
      ) : null}

      <section className="rounded-[4px] border border-border bg-surface">
        <div className="border-b border-border px-3 py-2 text-[12px] font-semibold">
          Job log
        </div>
        <pre className="max-h-[28rem] overflow-auto p-3 font-mono text-[11px] leading-relaxed text-foreground whitespace-pre-wrap">
          {job.log_text?.trim() || "(waiting for worker…)"}
        </pre>
      </section>
    </div>
  );
}
