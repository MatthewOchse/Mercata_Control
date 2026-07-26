import { notFound } from "next/navigation";
import { requireOperator } from "@/lib/auth/server";
import { buildDigestPayload } from "@/lib/digest/compose";
import {
  digestRecipients,
  getDigestTenantBySlug,
} from "@/lib/digest/send";
import {
  renderDigestHtml,
  renderDigestSubject,
} from "@/lib/digest/render";

export const dynamic = "force-dynamic";

/**
 * Exact HTML a customer would receive — full-bleed, no admin chrome.
 * Optional ?period=YYYY-MM-DD uses that SAST calendar day as the send date
 * (period windows are derived the same as the cron).
 */
export default async function DigestPreviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ period?: string }>;
}) {
  await requireOperator();
  const { slug } = await params;
  const sp = await searchParams;
  const tenant = await getDigestTenantBySlug(slug);
  if (!tenant) notFound();

  const recipients = await digestRecipients(tenant.id);
  const previewEmail = recipients[0] ?? "preview@mercata.co.za";
  const sendDate =
    sp.period && /^\d{4}-\d{2}-\d{2}$/.test(sp.period) ? sp.period : undefined;

  let html: string;
  let subject: string;
  let error: string | null = null;
  let periodLabel = "";

  try {
    const cadence =
      tenant.digest_cadence === "off" ? "weekly" : tenant.digest_cadence;
    const payload = await buildDigestPayload(tenant, previewEmail, {
      cadenceOverride: cadence,
      sendDate,
    });
    subject = renderDigestSubject(payload);
    periodLabel = payload.period.label;
    html = renderDigestHtml(payload);
  } catch (err) {
    subject = "Digest preview failed";
    error = err instanceof Error ? err.message : "Failed to build digest";
    html = `<!DOCTYPE html><html><body style="font-family:sans-serif;padding:24px;"><h1>Preview failed</h1><p>${error}</p></body></html>`;
  }

  return (
    <div style={{ minHeight: "100vh", background: "#e8e6e1" }}>
      <div
        style={{
          padding: "12px 16px",
          background: "#1a2b4a",
          color: "#fff",
          fontFamily:
            "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
          fontSize: 13,
          display: "flex",
          gap: 16,
          flexWrap: "wrap",
          alignItems: "center",
        }}
      >
        <strong>Digest preview</strong>
        <span style={{ opacity: 0.85 }}>{tenant.trading_name}</span>
        <span style={{ opacity: 0.7 }}>Subject: {subject}</span>
        {periodLabel ? (
          <span style={{ opacity: 0.7 }}>Period: {periodLabel}</span>
        ) : null}
        {error ? (
          <span style={{ color: "#f0c04a" }}>{error}</span>
        ) : (
          <span style={{ opacity: 0.7 }}>To: {previewEmail}</span>
        )}
        <a
          href={`/tenants/${slug}?tab=digest`}
          style={{ marginLeft: "auto", color: "#f0c04a" }}
        >
          ← Digest settings
        </a>
      </div>
      <iframe
        title="Digest email preview"
        srcDoc={html}
        style={{
          width: "100%",
          height: "calc(100vh - 48px)",
          border: 0,
          background: "#F8F7F5",
        }}
      />
    </div>
  );
}
