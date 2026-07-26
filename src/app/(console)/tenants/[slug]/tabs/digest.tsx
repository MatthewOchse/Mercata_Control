"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { DigestCadence } from "@/lib/digest/types";
import {
  sendTestDigestAction,
  testGa4ConnectionAction,
  updateDigestSettingsAction,
} from "../../actions";

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
  ga4VerifiedAt,
  ga4DisplayName,
  brandPrimaryColor,
  brandLogoUrl,
}: {
  slug: string;
  cadence: DigestCadence;
  digestDay: number;
  ga4PropertyId: string | null;
  ga4VerifiedAt: string | null;
  ga4DisplayName: string | null;
  brandPrimaryColor: string | null;
  brandLogoUrl: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [propertyId, setPropertyId] = useState(ga4PropertyId ?? "");

  const unverified = Boolean(propertyId.trim()) && !ga4VerifiedAt;

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

  function onTestGa4() {
    setError(null);
    setMessage(null);
    const fd = new FormData();
    fd.set("ga4_property_id", propertyId);
    startTransition(async () => {
      // Persist ID first so verify uses the same value
      const saveFd = new FormData();
      saveFd.set("digest_cadence", cadence);
      saveFd.set("digest_day", String(digestDay));
      saveFd.set("ga4_property_id", propertyId);
      saveFd.set("brand_primary_color", brandPrimaryColor ?? "");
      saveFd.set("brand_logo_url", brandLogoUrl ?? "");
      await updateDigestSettingsAction(slug, saveFd);
      const result = await testGa4ConnectionAction(slug, fd);
      if (result.error) {
        setError(result.error);
        return;
      }
      setMessage(result.message ?? "Connected");
      router.refresh();
    });
  }

  function onTestSend() {
    setError(null);
    setMessage(null);
    startTransition(async () => {
      const result = await sendTestDigestAction(slug);
      if (result.error) {
        setError(result.error);
        return;
      }
      setMessage(result.message ?? "Test sent");
    });
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {unverified ? (
        <div className="rounded-[4px] border border-status-warn bg-status-warn/10 p-3 text-[13px] text-status-warn lg:col-span-2">
          GA4 property ID is set but never verified. Use Test connection before
          relying on digests or the Analytics tab for traffic.
        </div>
      ) : null}
      {ga4VerifiedAt && ga4DisplayName ? (
        <div className="rounded-[4px] border border-status-ok/40 bg-status-ok/10 p-3 text-[13px] text-status-ok lg:col-span-2">
          Connected: {ga4DisplayName}
        </div>
      ) : null}

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
              <option value="monthly">Monthly (1st, 07:00 SAST)</option>
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
              value={propertyId}
              onChange={(e) => setPropertyId(e.target.value)}
              placeholder="123456789"
              className="w-full rounded-[4px] border border-border bg-background px-2 py-1.5 font-mono text-[12px]"
            />
            <span className="mt-1 block text-[11px] text-muted">
              Grant Viewer to the Mercata analytics service account. Leave blank
              for sales-only analytics.
            </span>
          </label>

          <button
            type="button"
            disabled={pending || !propertyId.trim()}
            onClick={onTestGa4}
            className="rounded-[4px] border border-border px-3 py-1.5 text-[13px] font-medium hover:border-primary-light hover:bg-primary hover:text-white disabled:opacity-60"
          >
            Test connection
          </button>

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
            <button
              type="button"
              disabled={pending}
              onClick={onTestSend}
              className="rounded-[4px] border border-border px-3 py-1.5 text-[13px] disabled:opacity-60"
            >
              Send test to me
            </button>
          </div>
        </form>
      </section>

      <section className="rounded-[4px] border border-border bg-surface p-4">
        <h3 className="mb-3 text-[12px] font-semibold tracking-wide text-muted uppercase">
          Notes
        </h3>
        <ul className="list-disc space-y-2 pl-4 text-[13px] text-muted">
          <li>Default for new tenants is weekly — opens get muted on daily.</li>
          <li>
            Digests and the Analytics tab share the analytics warehouse (nightly
            ETL). GA4 is optional; digests never fail without it.
          </li>
          <li>
            Recipients are set under Overview → Contacts (Invoices vs Analytics
            digests, multiple emails allowed). Unsubscribe sets cadence to
            off.
          </li>
          <li>
            WhatsApp scaffold only — contact consent fields exist; no BSP yet.
          </li>
        </ul>
      </section>
    </div>
  );
}
