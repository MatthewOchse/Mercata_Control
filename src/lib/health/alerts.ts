import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { writeAuditLog } from "@/lib/db/audit";
import { execute, query, withTransaction } from "@/lib/db/pool";
import {
  DEFAULT_COOLDOWN_HOURS,
  SIGNAL_LABEL,
  SIGNAL_SEVERITY,
  type AlertSignal,
} from "@/lib/health/types";
import type { SignalEvaluation } from "@/lib/health/signals";
import { notifyAll } from "@/lib/notify";

export async function isInMaintenance(tenantId: number): Promise<boolean> {
  const rows = await query<(RowDataPacket & { id: number })[]>(
    `SELECT id FROM maintenance_windows
     WHERE tenant_id = :tenantId
       AND starts_at <= UTC_TIMESTAMP(3)
       AND ends_at > UTC_TIMESTAMP(3)
     LIMIT 1`,
    { tenantId },
  );
  return rows.length > 0;
}

export async function silenceTenantForHours(
  tenantId: number,
  hours: number,
  reason: string,
  actor: string,
): Promise<void> {
  await withTransaction(async (conn) => {
    await conn.execute(
      `INSERT INTO maintenance_windows (tenant_id, starts_at, ends_at, reason, created_by)
       VALUES (?, UTC_TIMESTAMP(3), DATE_ADD(UTC_TIMESTAMP(3), INTERVAL ? HOUR), ?, ?)`,
      [tenantId, hours, reason, actor],
    );
    await writeAuditLog(conn, {
      actor,
      action: "maintenance.silence",
      entityType: "tenant",
      entityId: tenantId,
      after: { hours, reason, tenant_id: tenantId },
    });
  });
}

type AlertStateRow = RowDataPacket & {
  id: number;
  status: "open" | "resolved";
  last_fired_at: string | null;
  cooldown_until: string | null;
};

function formatAlertMessage(
  slug: string,
  signal: AlertSignal,
  event: "opened" | "recovered",
  detail: Record<string, unknown>,
): { subject: string; body: string } {
  const label = SIGNAL_LABEL[signal];
  if (event === "opened") {
    return {
      subject: `[${SIGNAL_SEVERITY[signal].toUpperCase()}] ${slug}: ${label}`,
      body: [
        `Tenant: ${slug}`,
        `Signal: ${label} (${signal})`,
        `Severity: ${SIGNAL_SEVERITY[signal]}`,
        `Details: ${JSON.stringify(detail)}`,
        "",
        "State change only — this alert will not re-fire until recovered + cooldown.",
      ].join("\n"),
    };
  }
  return {
    subject: `[RECOVERED] ${slug}: ${label}`,
    body: [
      `Tenant: ${slug}`,
      `Signal: ${label} (${signal}) has recovered.`,
      `Details: ${JSON.stringify(detail)}`,
    ].join("\n"),
  };
}

export async function applySignalEvaluations(opts: {
  tenantId: number;
  slug: string;
  evaluations: SignalEvaluation[];
}): Promise<void> {
  if (await isInMaintenance(opts.tenantId)) {
    return;
  }

  for (const ev of opts.evaluations) {
    await applyOneSignal(opts.tenantId, opts.slug, ev);
  }
}

async function applyOneSignal(
  tenantId: number,
  slug: string,
  ev: SignalEvaluation,
): Promise<void> {
  const severity = SIGNAL_SEVERITY[ev.signal];
  const existing = await query<AlertStateRow[]>(
    "SELECT id, status, last_fired_at, cooldown_until FROM alert_states WHERE tenant_id = :tenantId AND `signal` = :signal LIMIT 1",
    { tenantId, signal: ev.signal },
  );
  const row = existing[0];
  const status = row?.status ?? "resolved";

  if (ev.active) {
    if (status === "open") {
      await execute(
        "UPDATE alert_states SET details = CAST(:details AS JSON), updated_at = UTC_TIMESTAMP(3) WHERE tenant_id = :tenantId AND `signal` = :signal",
        {
          details: JSON.stringify(ev.detail),
          tenantId,
          signal: ev.signal,
        },
      );
      return;
    }

    if (row?.cooldown_until) {
      const until = new Date(row.cooldown_until).getTime();
      if (until > Date.now()) {
        return;
      }
    }

    const { subject, body } = formatAlertMessage(
      slug,
      ev.signal,
      "opened",
      ev.detail,
    );

    await withTransaction(async (conn) => {
      await conn.execute(
        `INSERT INTO alert_states
           (tenant_id, \`signal\`, severity, status, details, opened_at, last_fired_at, cooldown_until)
         VALUES (?, ?, ?, 'open', CAST(? AS JSON),
                 UTC_TIMESTAMP(3), UTC_TIMESTAMP(3),
                 DATE_ADD(UTC_TIMESTAMP(3), INTERVAL ? HOUR))
         ON DUPLICATE KEY UPDATE
           status = 'open',
           severity = VALUES(severity),
           details = VALUES(details),
           opened_at = UTC_TIMESTAMP(3),
           resolved_at = NULL,
           last_fired_at = UTC_TIMESTAMP(3),
           cooldown_until = DATE_ADD(UTC_TIMESTAMP(3), INTERVAL ? HOUR)`,
        [
          tenantId,
          ev.signal,
          severity,
          JSON.stringify(ev.detail),
          DEFAULT_COOLDOWN_HOURS,
          DEFAULT_COOLDOWN_HOURS,
        ],
      );
    });

    await dispatchAlert({
      tenantId,
      slug,
      signal: ev.signal,
      severity,
      event: "opened",
      subject,
      body,
      details: ev.detail,
    });
    return;
  }

  if (status !== "open") {
    if (!row) {
      await execute(
        "INSERT IGNORE INTO alert_states (tenant_id, `signal`, severity, status, details) VALUES (:tenantId, :signal, :severity, 'resolved', CAST(:details AS JSON))",
        {
          tenantId,
          signal: ev.signal,
          severity,
          details: JSON.stringify(ev.detail),
        },
      );
    }
    return;
  }

  const { subject, body } = formatAlertMessage(
    slug,
    ev.signal,
    "recovered",
    ev.detail,
  );

  await withTransaction(async (conn) => {
    await conn.execute(
      "UPDATE alert_states SET status = 'resolved', resolved_at = UTC_TIMESTAMP(3), details = CAST(? AS JSON), cooldown_until = DATE_ADD(UTC_TIMESTAMP(3), INTERVAL ? HOUR) WHERE tenant_id = ? AND `signal` = ?",
      [
        JSON.stringify(ev.detail),
        DEFAULT_COOLDOWN_HOURS,
        tenantId,
        ev.signal,
      ],
    );
  });

  await dispatchAlert({
    tenantId,
    slug,
    signal: ev.signal,
    severity,
    event: "recovered",
    subject,
    body,
    details: ev.detail,
  });
}

async function dispatchAlert(opts: {
  tenantId: number;
  slug: string;
  signal: AlertSignal;
  severity: "critical" | "warning";
  event: "opened" | "recovered";
  subject: string;
  body: string;
  details: Record<string, unknown>;
}): Promise<void> {
  if (opts.severity === "critical") {
    const channels = await notifyAll({
      subject: opts.subject,
      body: opts.body,
      severity: opts.event === "recovered" ? "info" : "critical",
      tenantSlug: opts.slug,
      signal: opts.signal,
    });
    const channelList = channels.length ? channels : ["none"];
    for (const ch of channelList) {
      await execute(
        "INSERT INTO alert_events (tenant_id, `signal`, event, severity, channel, message) VALUES (:tenantId, :signal, :event, :severity, :channel, :message)",
        {
          tenantId: opts.tenantId,
          signal: opts.signal,
          event: opts.event,
          severity: opts.severity,
          channel: ch,
          message: opts.subject,
        },
      );
    }
    return;
  }

  await execute(
    "INSERT INTO alert_digest_queue (tenant_id, `signal`, event, severity, message, details) VALUES (:tenantId, :signal, :event, 'warning', :message, CAST(:details AS JSON))",
    {
      tenantId: opts.tenantId,
      signal: opts.signal,
      event: opts.event,
      message: opts.subject,
      details: JSON.stringify(opts.details),
    },
  );
  await execute(
    "INSERT INTO alert_events (tenant_id, `signal`, event, severity, channel, message) VALUES (:tenantId, :signal, :event, 'warning', 'digest', :message)",
    {
      tenantId: opts.tenantId,
      signal: opts.signal,
      event: opts.event,
      message: opts.subject,
    },
  );
}

/** Send queued warning alerts as a single digest. */
export async function sendWarningDigest(): Promise<{ sent: number }> {
  const rows = await query<
    (RowDataPacket & {
      id: number;
      tenant_id: number;
      signal: string;
      event: string;
      message: string;
      slug: string;
    })[]
  >(
    "SELECT q.id, q.tenant_id, q.`signal`, q.event, q.message, t.slug FROM alert_digest_queue q INNER JOIN tenants t ON t.id = q.tenant_id WHERE q.sent_at IS NULL ORDER BY q.created_at ASC",
  );

  if (rows.length === 0) {
    return { sent: 0 };
  }

  const lines = rows.map(
    (r) =>
      `• [${r.event}] ${r.slug} — ${SIGNAL_LABEL[r.signal as AlertSignal] ?? r.signal}: ${r.message}`,
  );
  const subject = `Mercata health digest — ${rows.length} warning event(s)`;
  const body = [
    "Warning-level health alerts (batched 08:00 SAST).",
    "Critical alerts are sent immediately and are not listed here.",
    "",
    ...lines,
  ].join("\n");

  await notifyAll({
    subject,
    body,
    severity: "warning",
  });

  const ids = rows.map((r) => Number(r.id));
  await withTransaction(async (conn) => {
    await conn.execute<ResultSetHeader>(
      `UPDATE alert_digest_queue SET sent_at = UTC_TIMESTAMP(3)
       WHERE id IN (${ids.map(() => "?").join(",")})`,
      ids,
    );
  });

  return { sent: rows.length };
}
