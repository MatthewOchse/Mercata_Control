"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { DigestCadence } from "@/lib/digest/types";
import { updateDigestSettingsAction } from "../../actions";

const DAYS = [
  { value: 1, label: "Monday" },
  { value: 2, label: "Tuesday" },
  { value: 3, label: "Wednesday" },
  { value: 4, label: "Thursday" },
  { value: 5, label: "Friday" },
  { value: 6, label: "Saturday" },
  { value: 7, label: "Sunday" },
] as const;

export function DigestTab({
  slug,
  cadence,
  digestDay,
  ga4PropertyId,
  brandPrimaryColor,
  brandLogoUrl,
}: {
  slug: string;
  cadence: DigestCadence;
  digestDay: number;
  ga4PropertyId: string | null;
  brandPrimaryColor: string | null;
  brandLogoUrl: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setMessage(null);
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      const result = await updateDigestSettingsAction(slug, fd);
      if (result.error) {
        setError(result.error);
        return;
      }
      setMessage(result.message ?? "Saved");
      router.refresh();
    });
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <section className="rounded-[4px] border border-border bg-surface p-4">
        <h3 className="mb-3 text-[12px] font-semibold tracking-wide text-muted uppercase">
          Cadence &amp; brand
        </h3>
        <form onSubmit={onSubmit} className="space-y-3 text-[13px]">
          <label className="block">
            <span className="mb-1 block text-muted">Cadence</span>
            <select
              name="digest_cadence"
              defaultValue={cadence}
              className="w-full rounded-[4px] border border-border bg-background px-2 py-1.5"
            >
              <option value="weekly">Weekly (recommended)</option>
              <option value="daily">Daily</option>
              <option value="off">Off</option>
            </select>
          </label>

          <label className="block">
            <span className="mb-1 block text-muted">
              Weekly send day (07:00 SAST)
            </span>
            <select
              name="digest_day"
              defaultValue={digestDay}
              className="w-full rounded-[4px] border border-border bg-background px-2 py-1.5"
            >
              {DAYS.map((d) => (
                <option key={d.value} value={d.value}>
                  {d.label}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="mb-1 block text-muted">GA4 property ID</span>
            <input
              name="ga4_property_id"
              defaultValue={ga4PropertyId ?? ""}
              placeholder="123456789"
              className="w-full rounded-[4px] border border-border bg-background px-2 py-1.5 font-mono text-[12px]"
            />
            <span className="mt-1 block text-[11px] text-muted">
              Optional. Omit to skip the traffic section — digests still send.
            </span>
          </label>

          <label className="block">
            <span className="mb-1 block text-muted">Brand primary colour</span>
            <input
              name="brand_primary_color"
              defaultValue={brandPrimaryColor ?? ""}
              placeholder="#2B6CB0"
              className="w-full rounded-[4px] border border-border bg-background px-2 py-1.5 font-mono text-[12px]"
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-muted">Brand logo URL</span>
            <input
              name="brand_logo_url"
              defaultValue={brandLogoUrl ?? ""}
              placeholder="https://…"
              className="w-full rounded-[4px] border border-border bg-background px-2 py-1.5 font-mono text-[12px]"
            />
          </label>

          {error ? (
            <p className="text-[13px] text-status-error">{error}</p>
          ) : null}
          {message ? (
            <p className="text-[13px] text-status-ok">{message}</p>
          ) : null}

          <div className="flex flex-wrap gap-2 pt-1">
            <button
              type="submit"
              disabled={pending}
              className="rounded-[4px] bg-accent-strong px-3 py-1.5 text-[13px] font-medium text-white disabled:opacity-60"
            >
              {pending ? "Saving…" : "Save digest settings"}
            </button>
            <Link
              href={`/tenants/${slug}/digest/preview`}
              className="rounded-[4px] border border-border px-3 py-1.5 text-[13px] text-foreground hover:bg-background"
            >
              Preview email
            </Link>
          </div>
        </form>
      </section>

      <section className="rounded-[4px] border border-border bg-surface p-4">
        <h3 className="mb-3 text-[12px] font-semibold tracking-wide text-muted uppercase">
          Notes
        </h3>
        <ul className="list-disc space-y-2 pl-4 text-[13px] text-muted">
          <li>
            Sales always come from the tenant fleet stats endpoint (source of
            truth).
          </li>
          <li>
            GA4 uses the shared Google service account (
            <code className="font-mono text-[11px]">GOOGLE_SERVICE_ACCOUNT_JSON</code>
            ) as a viewer on each property.
          </li>
          <li>
            Unsubscribe links set cadence to off for the whole tenant.
          </li>
          <li>
            WhatsApp is scaffolded only — consent fields exist on contacts;
            no BSP adapter yet.
          </li>
        </ul>
      </section>
    </div>
  );
}
