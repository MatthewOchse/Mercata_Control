import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import {
  firstDayOfNextMonth,
  lastDayOfThisMonth,
  sastToday,
} from "@/lib/billing/cycle";
import {
  encryptSecret,
  generateFleetSecret,
} from "@/lib/crypto/secrets";
import { writeAuditLog } from "@/lib/db/audit";
import { withTransaction, type PoolConnection } from "@/lib/db/pool";
import type { TenantStatus } from "@/lib/tenants/types";

export type CreateTenantInput = {
  legalName: string;
  tradingName: string;
  slug: string;
  primaryContact: { name: string; email: string; phone?: string };
  billingContact: { name: string; email: string; phone?: string };
  primaryDomain: string;
  planCode: string;
  setupFeeCents: number;
  host?: string;
  actor: string;
};

function normaliseSlug(slug: string): string {
  return slug
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function getPlanCents(
  conn: PoolConnection,
  planCode: string,
): Promise<number> {
  const [rows] = await conn.execute<(RowDataPacket & { monthly_cents: number })[]>(
    `SELECT monthly_cents FROM plans WHERE code = ? AND active = 1 LIMIT 1`,
    [planCode],
  );
  const row = rows[0];
  if (!row) throw new Error(`Unknown or inactive plan: ${planCode}`);
  return Number(row.monthly_cents);
}

async function loadTenant(
  conn: PoolConnection,
  slug: string,
): Promise<RowDataPacket & { id: number; slug: string; status: TenantStatus }> {
  const [rows] = await conn.execute<RowDataPacket[]>(
    `SELECT id, slug, status, legal_name, trading_name FROM tenants WHERE slug = ? LIMIT 1`,
    [slug],
  );
  const row = rows[0] as
    | (RowDataPacket & { id: number; slug: string; status: TenantStatus })
    | undefined;
  if (!row) throw new Error(`Tenant not found: ${slug}`);
  return { ...row, id: Number(row.id) };
}

export async function createTenant(input: CreateTenantInput): Promise<{ slug: string }> {
  const slug = normaliseSlug(input.slug);
  if (!slug) throw new Error("Slug is required");
  if (input.setupFeeCents < 0 || !Number.isInteger(input.setupFeeCents)) {
    throw new Error("Setup fee must be a non-negative integer (cents)");
  }

  const today = sastToday();
  const host = input.host?.trim() || "caesar";
  const containerName = slug;
  const dbName = slug.replace(/-/g, "_");
  const fleetPlain = generateFleetSecret();
  const fleetCipher = encryptSecret(fleetPlain);

  return withTransaction(async (conn) => {
    const monthlyCents = await getPlanCents(conn, input.planCode);

    const [tenantResult] = await conn.execute<ResultSetHeader>(
      `INSERT INTO tenants (slug, legal_name, trading_name, status)
       VALUES (?, ?, ?, 'prospect')`,
      [slug, input.legalName.trim(), input.tradingName.trim()],
    );
    const tenantId = Number(tenantResult.insertId);

    await conn.execute(
      `INSERT INTO tenant_contacts (tenant_id, name, email, phone, role, is_primary)
       VALUES (?, ?, ?, ?, 'primary', 1)`,
      [
        tenantId,
        input.primaryContact.name.trim(),
        input.primaryContact.email.trim().toLowerCase(),
        input.primaryContact.phone?.trim() || null,
      ],
    );

    await conn.execute(
      `INSERT INTO tenant_contacts (tenant_id, name, email, phone, role, is_primary)
       VALUES (?, ?, ?, ?, 'billing', 0)`,
      [
        tenantId,
        input.billingContact.name.trim(),
        input.billingContact.email.trim().toLowerCase(),
        input.billingContact.phone?.trim() || null,
      ],
    );

    await conn.execute(
      `INSERT INTO tenant_infra
         (tenant_id, primary_domain, extra_domains, container_name, db_name, host, fleet_secret)
       VALUES (?, ?, NULL, ?, ?, ?, ?)`,
      [
        tenantId,
        input.primaryDomain.trim().toLowerCase(),
        containerName,
        dbName,
        host,
        fleetCipher,
      ],
    );

    // Subscription exists but tenant is still prospect — started_on set on Activate.
    const [subResult] = await conn.execute<ResultSetHeader>(
      `INSERT INTO subscriptions
         (tenant_id, plan_code, status, started_on, ends_on, current_monthly_cents)
       VALUES (?, ?, 'active', ?, NULL, ?)`,
      [tenantId, input.planCode, today, monthlyCents],
    );

    if (input.setupFeeCents > 0) {
      await conn.execute(
        `INSERT INTO addons
           (tenant_id, description, kind, amount_cents, active_from, active_until)
         VALUES (?, 'Setup fee', 'once_off', ?, ?, NULL)`,
        [tenantId, input.setupFeeCents, today],
      );
    }

    await writeAuditLog(conn, {
      actor: input.actor,
      action: "tenant.create",
      entityType: "tenant",
      entityId: tenantId,
      after: {
        slug,
        status: "prospect",
        plan_code: input.planCode,
        current_monthly_cents: monthlyCents,
        setup_fee_cents: input.setupFeeCents,
        subscription_id: Number(subResult.insertId),
        tenant_id: tenantId,
      },
    });

    return { slug };
  });
}

export async function activateTenant(slug: string, actor: string): Promise<void> {
  const today = sastToday();
  await withTransaction(async (conn) => {
    const tenant = await loadTenant(conn, slug);
    if (tenant.status !== "prospect") {
      throw new Error("Only prospect tenants can be activated");
    }

    const before = { status: tenant.status };

    await conn.execute(
      `UPDATE tenants
       SET status = 'active', onboarded_at = UTC_TIMESTAMP(3)
       WHERE id = ?`,
      [tenant.id],
    );

    const [subs] = await conn.execute<(RowDataPacket & { id: number })[]>(
      `SELECT id FROM subscriptions
       WHERE tenant_id = ? AND status = 'active' AND ends_on IS NULL
       ORDER BY id ASC LIMIT 1`,
      [tenant.id],
    );
    const sub = subs[0];
    if (!sub) throw new Error("No open subscription to activate");

    await conn.execute(
      `UPDATE subscriptions SET started_on = ? WHERE id = ?`,
      [today, sub.id],
    );

    await writeAuditLog(conn, {
      actor,
      action: "tenant.activate",
      entityType: "tenant",
      entityId: tenant.id,
      before,
      after: {
        status: "active",
        started_on: today,
        subscription_id: Number(sub.id),
        tenant_id: tenant.id,
        slug,
      },
    });
  });
}

export async function changePlan(
  slug: string,
  newPlanCode: string,
  actor: string,
): Promise<{ effectiveOn: string; endsOn: string }> {
  const endsOn = lastDayOfThisMonth();
  const effectiveOn = firstDayOfNextMonth();

  await withTransaction(async (conn) => {
    const tenant = await loadTenant(conn, slug);
    if (tenant.status === "offboarded") {
      throw new Error("Cannot change plan for an offboarded tenant");
    }
    if (tenant.status === "prospect") {
      throw new Error("Activate the tenant before changing plan, or edit the prospect subscription via recreate");
    }

    const monthlyCents = await getPlanCents(conn, newPlanCode);
    const today = sastToday();

    const [subs] = await conn.execute<
      (RowDataPacket & {
        id: number;
        plan_code: string;
        current_monthly_cents: number;
      })[]
    >(
      `SELECT id, plan_code, current_monthly_cents FROM subscriptions
       WHERE tenant_id = ?
         AND status = 'active'
         AND started_on <= ?
         AND (ends_on IS NULL OR ends_on >= ?)
       ORDER BY started_on DESC, id DESC
       LIMIT 1`,
      [tenant.id, today, today],
    );
    const current = subs[0];
    if (!current) throw new Error("No current subscription to change");
    if (current.plan_code === newPlanCode) {
      throw new Error("Tenant is already on that plan");
    }

    // Never mutate price. Schedule end-of-month; leave status active until then.
    await conn.execute(
      `UPDATE subscriptions SET ends_on = ? WHERE id = ?`,
      [endsOn, current.id],
    );

    const [inserted] = await conn.execute<ResultSetHeader>(
      `INSERT INTO subscriptions
         (tenant_id, plan_code, status, started_on, ends_on, current_monthly_cents)
       VALUES (?, ?, 'active', ?, NULL, ?)`,
      [tenant.id, newPlanCode, effectiveOn, monthlyCents],
    );

    await writeAuditLog(conn, {
      actor,
      action: "tenant.change_plan",
      entityType: "subscription",
      entityId: Number(inserted.insertId),
      before: {
        tenant_id: tenant.id,
        slug,
        subscription_id: Number(current.id),
        plan_code: current.plan_code,
        current_monthly_cents: Number(current.current_monthly_cents),
      },
      after: {
        tenant_id: tenant.id,
        slug,
        plan_code: newPlanCode,
        current_monthly_cents: monthlyCents,
        started_on: effectiveOn,
        previous_ends_on: endsOn,
      },
    });
  });

  return { effectiveOn, endsOn };
}

export async function addAddon(
  slug: string,
  input: {
    description: string;
    kind: "recurring" | "once_off";
    amountCents: number;
  },
  actor: string,
): Promise<{ activeFrom: string }> {
  if (!Number.isInteger(input.amountCents) || input.amountCents === 0) {
    throw new Error("Addon amount must be a non-zero integer (cents)");
  }
  const activeFrom =
    input.kind === "recurring" ? firstDayOfNextMonth() : sastToday();

  await withTransaction(async (conn) => {
    const tenant = await loadTenant(conn, slug);
    if (tenant.status === "offboarded") {
      throw new Error("Cannot add addons to an offboarded tenant");
    }

    const [result] = await conn.execute<ResultSetHeader>(
      `INSERT INTO addons
         (tenant_id, description, kind, amount_cents, active_from, active_until)
       VALUES (?, ?, ?, ?, ?, NULL)`,
      [
        tenant.id,
        input.description.trim(),
        input.kind,
        input.amountCents,
        activeFrom,
      ],
    );

    await writeAuditLog(conn, {
      actor,
      action: "addon.add",
      entityType: "addon",
      entityId: Number(result.insertId),
      after: {
        tenant_id: tenant.id,
        slug,
        description: input.description.trim(),
        kind: input.kind,
        amount_cents: input.amountCents,
        active_from: activeFrom,
      },
    });
  });

  return { activeFrom };
}

export async function removeAddon(
  slug: string,
  addonId: number,
  actor: string,
): Promise<{ activeUntil: string | null }> {
  let activeUntil: string | null = null;

  await withTransaction(async (conn) => {
    const tenant = await loadTenant(conn, slug);
    const [rows] = await conn.execute<(RowDataPacket & {
      id: number;
      kind: "recurring" | "once_off";
      description: string;
      amount_cents: number;
      active_from: string;
      active_until: string | null;
    })[]>(
      `SELECT id, kind, description, amount_cents, active_from, active_until
       FROM addons WHERE id = ? AND tenant_id = ? LIMIT 1`,
      [addonId, tenant.id],
    );
    const addon = rows[0];
    if (!addon) throw new Error("Addon not found");

    if (addon.kind === "recurring") {
      activeUntil = lastDayOfThisMonth();
      await conn.execute(
        `UPDATE addons SET active_until = ? WHERE id = ?`,
        [activeUntil, addon.id],
      );
    } else {
      // Once-off not yet invoiced: end immediately so it won't hit the next invoice.
      activeUntil = sastToday();
      await conn.execute(
        `UPDATE addons SET active_until = ? WHERE id = ?`,
        [activeUntil, addon.id],
      );
    }

    await writeAuditLog(conn, {
      actor,
      action: "addon.remove",
      entityType: "addon",
      entityId: addon.id,
      before: {
        tenant_id: tenant.id,
        slug,
        kind: addon.kind,
        description: addon.description,
        amount_cents: Number(addon.amount_cents),
        active_until: addon.active_until,
      },
      after: {
        tenant_id: tenant.id,
        slug,
        active_until: activeUntil,
      },
    });
  });

  return { activeUntil };
}

export async function suspendTenant(slug: string, actor: string): Promise<void> {
  await withTransaction(async (conn) => {
    const tenant = await loadTenant(conn, slug);
    if (tenant.status !== "active") {
      throw new Error("Only active tenants can be suspended");
    }
    await conn.execute(`UPDATE tenants SET status = 'suspended' WHERE id = ?`, [
      tenant.id,
    ]);
    await writeAuditLog(conn, {
      actor,
      action: "tenant.suspend",
      entityType: "tenant",
      entityId: tenant.id,
      before: { status: "active", slug },
      after: {
        status: "suspended",
        slug,
        tenant_id: tenant.id,
        note: "Billing continues — dunning action, not offboarding",
      },
    });
  });
}

export async function unsuspendTenant(slug: string, actor: string): Promise<void> {
  await withTransaction(async (conn) => {
    const tenant = await loadTenant(conn, slug);
    if (tenant.status !== "suspended") {
      throw new Error("Only suspended tenants can be unsuspended");
    }
    await conn.execute(`UPDATE tenants SET status = 'active' WHERE id = ?`, [
      tenant.id,
    ]);
    await writeAuditLog(conn, {
      actor,
      action: "tenant.unsuspend",
      entityType: "tenant",
      entityId: tenant.id,
      before: { status: "suspended", slug },
      after: { status: "active", slug, tenant_id: tenant.id },
    });
  });
}

export async function regenerateFleetSecret(
  slug: string,
  actor: string,
): Promise<string> {
  const plain = generateFleetSecret();
  const cipher = encryptSecret(plain);

  await withTransaction(async (conn) => {
    const tenant = await loadTenant(conn, slug);
    if (tenant.status === "offboarded") {
      throw new Error("Cannot regenerate secret for an offboarded tenant");
    }
    await conn.execute(
      `UPDATE tenant_infra SET fleet_secret = ? WHERE tenant_id = ?`,
      [cipher, tenant.id],
    );
    await writeAuditLog(conn, {
      actor,
      action: "tenant_infra.regenerate_secret",
      entityType: "tenant_infra",
      entityId: tenant.id,
      before: { tenant_id: tenant.id, slug, fleet_secret: "[redacted]" },
      after: { tenant_id: tenant.id, slug, fleet_secret: "[rotated]" },
    });
  });

  return plain;
}

export type OffboardExport = {
  json: string;
  csv: string;
  filenameBase: string;
};

export async function offboardTenant(
  slug: string,
  confirmSlug: string,
  actor: string,
): Promise<OffboardExport> {
  if (confirmSlug.trim() !== slug) {
    throw new Error("Confirmation slug does not match — offboard cancelled");
  }

  const endsOn = lastDayOfThisMonth();
  const today = sastToday();

  return withTransaction(async (conn) => {
    const tenant = await loadTenant(conn, slug);
    if (tenant.status === "offboarded") {
      throw new Error("Tenant is already offboarded");
    }
    if (tenant.status === "prospect") {
      // Prospects can offboard immediately (no period end).
    }

    const [contacts] = await conn.execute<RowDataPacket[]>(
      `SELECT * FROM tenant_contacts WHERE tenant_id = ?`,
      [tenant.id],
    );
    const [infra] = await conn.execute<RowDataPacket[]>(
      `SELECT id, tenant_id, primary_domain, extra_domains, container_name, db_name, host, health_path
       FROM tenant_infra WHERE tenant_id = ?`,
      [tenant.id],
    );
    const [subs] = await conn.execute<RowDataPacket[]>(
      `SELECT * FROM subscriptions WHERE tenant_id = ?`,
      [tenant.id],
    );
    const [addons] = await conn.execute<RowDataPacket[]>(
      `SELECT * FROM addons WHERE tenant_id = ?`,
      [tenant.id],
    );
    const [invoices] = await conn.execute<RowDataPacket[]>(
      `SELECT * FROM invoices WHERE tenant_id = ?`,
      [tenant.id],
    );
    const [lines] = await conn.execute<RowDataPacket[]>(
      `SELECT il.* FROM invoice_lines il
       INNER JOIN invoices i ON i.id = il.invoice_id
       WHERE i.tenant_id = ?`,
      [tenant.id],
    );
    const [creditNotes] = await conn.execute<RowDataPacket[]>(
      `SELECT cn.* FROM credit_notes cn
       INNER JOIN invoices i ON i.id = cn.invoice_id
       WHERE i.tenant_id = ?`,
      [tenant.id],
    );
    const [payments] = await conn.execute<RowDataPacket[]>(
      `SELECT * FROM payments WHERE tenant_id = ?`,
      [tenant.id],
    );

    const bundle = {
      exported_at: new Date().toISOString(),
      tenant,
      contacts,
      infra,
      subscriptions: subs,
      addons,
      invoices,
      invoice_lines: lines,
      credit_notes: creditNotes,
      payments,
    };

    await conn.execute(
      `UPDATE tenants
       SET status = 'offboarded', offboarded_at = UTC_TIMESTAMP(3)
       WHERE id = ?`,
      [tenant.id],
    );

    await conn.execute(
      `UPDATE subscriptions
       SET ends_on = COALESCE(ends_on, ?), status = 'cancelled'
       WHERE tenant_id = ? AND status = 'active' AND (ends_on IS NULL OR ends_on > ?)`,
      [endsOn, tenant.id, today],
    );

    await writeAuditLog(conn, {
      actor,
      action: "tenant.offboard",
      entityType: "tenant",
      entityId: tenant.id,
      before: { status: tenant.status, slug },
      after: {
        status: "offboarded",
        slug,
        tenant_id: tenant.id,
        subscription_ends_on: endsOn,
        note: "Financial history retained; no hard delete",
      },
    });

    const csv = buildFinancialCsv({
      invoices: invoices as RowDataPacket[],
      payments: payments as RowDataPacket[],
      creditNotes: creditNotes as RowDataPacket[],
    });

    return {
      json: JSON.stringify(bundle, null, 2),
      csv,
      filenameBase: `${slug}-export-${today}`,
    };
  });
}

function csvEscape(value: unknown): string {
  const s = value == null ? "" : String(value);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function buildFinancialCsv(data: {
  invoices: RowDataPacket[];
  payments: RowDataPacket[];
  creditNotes: RowDataPacket[];
}): string {
  const lines: string[] = [];
  lines.push("section,id,number,status,date,amount_cents,reference");
  for (const inv of data.invoices) {
    lines.push(
      [
        "invoice",
        inv.id,
        inv.invoice_number,
        inv.status,
        inv.issue_date,
        inv.total_cents,
        "",
      ]
        .map(csvEscape)
        .join(","),
    );
  }
  for (const p of data.payments) {
    lines.push(
      [
        "payment",
        p.id,
        "",
        p.method,
        p.received_on,
        p.amount_cents,
        p.reference ?? "",
      ]
        .map(csvEscape)
        .join(","),
    );
  }
  for (const cn of data.creditNotes) {
    lines.push(
      [
        "credit_note",
        cn.id,
        cn.credit_note_number,
        "",
        cn.issued_at,
        cn.total_cents,
        "",
      ]
        .map(csvEscape)
        .join(","),
    );
  }
  return lines.join("\n");
}
