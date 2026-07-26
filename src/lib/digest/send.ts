import type { RowDataPacket } from "mysql2/promise";
import { query } from "@/lib/db/pool";
import { buildDigestPayload, type DigestTenantInput } from "@/lib/digest/compose";
import { shouldSendDigestToday } from "@/lib/digest/period";
import {
  renderDigestHtml,
  renderDigestSubject,
  renderDigestText,
} from "@/lib/digest/render";
import type { DigestCadence } from "@/lib/digest/types";
import { unsubscribeUrl } from "@/lib/digest/unsubscribe";
import { createDigestEmailChannel } from "@/lib/notifications/email";

type DigestTenantRow = RowDataPacket & {
  id: number;
  slug: string;
  trading_name: string;
  digest_cadence: DigestCadence;
  digest_day: number;
  ga4_property_id: string | null;
  ga4_verified_at: string | null;
  brand_primary_color: string | null;
  brand_logo_url: string | null;
  primary_domain: string | null;
  fleet_secret: string | null;
};

type ContactRow = RowDataPacket & {
  email: string;
  role: string;
  is_primary: number;
};

export type DigestRunSummary = {
  considered: number;
  sent: number;
  failed: number;
  skipped: number;
  errors: string[];
};

function toInput(row: DigestTenantRow): DigestTenantInput {
  return {
    id: Number(row.id),
    slug: row.slug,
    trading_name: row.trading_name,
    digest_cadence: row.digest_cadence,
    digest_day: Number(row.digest_day),
    ga4_property_id: row.ga4_property_id,
    ga4_verified_at: row.ga4_verified_at
      ? String(row.ga4_verified_at)
      : null,
    brand_primary_color: row.brand_primary_color,
    brand_logo_url: row.brand_logo_url,
    primary_domain: row.primary_domain,
    fleet_secret: row.fleet_secret,
  };
}

async function alreadySent(
  tenantId: number,
  periodStart: string,
  periodEnd: string,
  recipient: string,
): Promise<boolean> {
  const rows = await query<(RowDataPacket & { c: number })[]>(
    `SELECT COUNT(*) AS c FROM digest_sends
     WHERE tenant_id = :tenantId
       AND period_start = :periodStart
       AND period_end = :periodEnd
       AND recipient = :recipient
       AND status = 'sent'`,
    { tenantId, periodStart, periodEnd, recipient },
  );
  return Number(rows[0]?.c ?? 0) > 0;
}

async function logSend(opts: {
  tenantId: number;
  cadence: "daily" | "weekly" | "monthly";
  periodStart: string;
  periodEnd: string;
  recipient: string;
  subject: string;
  status: "sent" | "failed";
  error?: string;
}): Promise<void> {
  await query(
    `INSERT INTO digest_sends
       (tenant_id, cadence, period_start, period_end, recipient, subject, status, error)
     VALUES
       (:tenantId, :cadence, :periodStart, :periodEnd, :recipient, :subject, :status, :error)`,
    {
      tenantId: opts.tenantId,
      cadence: opts.cadence,
      periodStart: opts.periodStart,
      periodEnd: opts.periodEnd,
      recipient: opts.recipient,
      subject: opts.subject,
      status: opts.status,
      error: opts.error ?? null,
    },
  );
}

/** Recipients flagged for analytics digests (supports multiple emails). */
export async function digestRecipients(
  tenantId: number,
): Promise<string[]> {
  const flagged = await query<ContactRow[]>(
    `SELECT email, role, is_primary
     FROM tenant_contacts
     WHERE tenant_id = :tenantId AND receive_digests = 1`,
    { tenantId },
  );
  const rows =
    flagged.length > 0
      ? flagged
      : await query<ContactRow[]>(
          `SELECT email, role, is_primary
           FROM tenant_contacts
           WHERE tenant_id = :tenantId
             AND (is_primary = 1 OR role IN ('primary', 'billing'))`,
          { tenantId },
        );
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of rows) {
    const email = r.email.trim().toLowerCase();
    if (!email || seen.has(email)) continue;
    seen.add(email);
    out.push(r.email.trim());
  }
  return out;
}

export async function listDigestTenants(): Promise<DigestTenantInput[]> {
  const rows = await query<DigestTenantRow[]>(
    `SELECT t.id, t.slug, t.trading_name,
            t.digest_cadence, t.digest_day, t.ga4_property_id, t.ga4_verified_at,
            t.brand_primary_color, t.brand_logo_url,
            i.primary_domain, i.fleet_secret
     FROM tenants t
     LEFT JOIN tenant_infra i ON i.tenant_id = t.id
     WHERE t.status = 'active'
       AND t.digest_cadence IN ('daily', 'weekly', 'monthly')`,
  );
  return rows.map(toInput);
}

export async function getDigestTenantBySlug(
  slug: string,
): Promise<DigestTenantInput | null> {
  const rows = await query<DigestTenantRow[]>(
    `SELECT t.id, t.slug, t.trading_name,
            t.digest_cadence, t.digest_day, t.ga4_property_id, t.ga4_verified_at,
            t.brand_primary_color, t.brand_logo_url,
            i.primary_domain, i.fleet_secret
     FROM tenants t
     LEFT JOIN tenant_infra i ON i.tenant_id = t.id
     WHERE t.slug = :slug LIMIT 1`,
    { slug },
  );
  return rows[0] ? toInput(rows[0]) : null;
}

export async function updateDigestSettings(opts: {
  slug: string;
  cadence: DigestCadence;
  digestDay: number;
  ga4PropertyId: string | null;
  brandPrimaryColor: string | null;
  brandLogoUrl: string | null;
}): Promise<void> {
  if (opts.digestDay < 1 || opts.digestDay > 7) {
    throw new Error("digest_day must be 1–7 (Mon–Sun)");
  }
  const existing = await query<(RowDataPacket & { ga4_property_id: string | null })[]>(
    `SELECT ga4_property_id FROM tenants WHERE slug = :slug LIMIT 1`,
    { slug: opts.slug },
  );
  const prev = existing[0]?.ga4_property_id ?? null;
  const changed = (prev ?? "") !== (opts.ga4PropertyId ?? "");

  await query(
    `UPDATE tenants SET
       digest_cadence = :cadence,
       digest_day = :digestDay,
       ga4_property_id = :ga4,
       brand_primary_color = :primary,
       brand_logo_url = :logo
       ${
         changed
           ? ", ga4_verified_at = NULL, ga4_display_name = NULL, ga4_consecutive_failures = 0"
           : ""
       }
     WHERE slug = :slug`,
    {
      slug: opts.slug,
      cadence: opts.cadence,
      digestDay: opts.digestDay,
      ga4: opts.ga4PropertyId,
      primary: opts.brandPrimaryColor,
      logo: opts.brandLogoUrl,
    },
  );
}

/** Send one test digest to the operator (does not log as customer send). */
export async function sendTestDigest(opts: {
  slug: string;
  to: string;
  sendDate?: string;
}): Promise<{ subject: string }> {
  const tenant = await getDigestTenantBySlug(opts.slug);
  if (!tenant) throw new Error("Tenant not found");
  const cadence =
    tenant.digest_cadence === "off"
      ? "weekly"
      : (tenant.digest_cadence as "daily" | "weekly" | "monthly");
  const payload = await buildDigestPayload(tenant, opts.to, {
    sendDate: opts.sendDate,
    cadenceOverride: cadence,
  });
  const channel = createDigestEmailChannel();
  if (!channel) throw new Error("RESEND_API_KEY not configured");
  const subject = `[TEST] ${renderDigestSubject(payload)}`;
  await channel.send({
    to: opts.to,
    subject,
    text: renderDigestText(payload),
    html: renderDigestHtml(payload),
    tenantSlug: tenant.slug,
    kind: "digest",
  });
  return { subject };
}

/**
 * Cron entry: send digests due today (SAST weekday / daily).
 * Intended for 07:00 SAST (05:00 UTC).
 */
export async function runDigestSends(
  now: Date = new Date(),
): Promise<DigestRunSummary> {
  const channel = createDigestEmailChannel();
  const summary: DigestRunSummary = {
    considered: 0,
    sent: 0,
    failed: 0,
    skipped: 0,
    errors: [],
  };

  if (!channel) {
    summary.errors.push("RESEND_API_KEY not configured");
    return summary;
  }

  const tenants = await listDigestTenants();
  for (const tenant of tenants) {
    if (
      !shouldSendDigestToday({
        cadence: tenant.digest_cadence,
        digestDay: tenant.digest_day,
        now,
      })
    ) {
      summary.skipped += 1;
      continue;
    }
    summary.considered += 1;

    if (!tenant.primary_domain || !tenant.fleet_secret) {
      summary.failed += 1;
      summary.errors.push(`${tenant.slug}: missing infra`);
      continue;
    }

    const recipients = await digestRecipients(tenant.id);
    if (recipients.length === 0) {
      summary.failed += 1;
      summary.errors.push(`${tenant.slug}: no contacts`);
      continue;
    }

    let payload;
    try {
      payload = await buildDigestPayload(tenant, recipients[0]!);
    } catch (err) {
      summary.failed += 1;
      const msg = err instanceof Error ? err.message : "compose failed";
      summary.errors.push(`${tenant.slug}: ${msg}`);
      continue;
    }

    const subject = renderDigestSubject(payload);

    for (const recipient of recipients) {
      if (
        await alreadySent(
          tenant.id,
          payload.period.from,
          payload.period.to,
          recipient,
        )
      ) {
        summary.skipped += 1;
        continue;
      }

      const perPayload = {
        ...payload,
        unsubscribeUrl: unsubscribeUrl(tenant.id, recipient),
      };
      const html = renderDigestHtml(perPayload);
      const text = renderDigestText(perPayload);

      try {
        await channel.send({
          to: recipient,
          subject,
          text,
          html,
          tenantSlug: tenant.slug,
          kind: "digest",
        });
        await logSend({
          tenantId: tenant.id,
          cadence: payload.cadence,
          periodStart: payload.period.from,
          periodEnd: payload.period.to,
          recipient,
          subject,
          status: "sent",
        });
        summary.sent += 1;
      } catch (err) {
        const msg = err instanceof Error ? err.message : "send failed";
        await logSend({
          tenantId: tenant.id,
          cadence: payload.cadence,
          periodStart: payload.period.from,
          periodEnd: payload.period.to,
          recipient,
          subject,
          status: "failed",
          error: msg,
        });
        summary.failed += 1;
        summary.errors.push(`${tenant.slug} → ${recipient}: ${msg}`);
      }
    }
  }

  return summary;
}
