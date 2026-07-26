import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import {
  firstDayOfNextMonth,
  firstDayOfThisMonth,
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
  primaryContact: {
    name: string;
    email: string;
    phone?: string;
    receiveInvoices?: boolean;
    receiveDigests?: boolean;
  };
  billingContact: {
    name: string;
    email: string;
    phone?: string;
    receiveInvoices?: boolean;
    receiveDigests?: boolean;
  };
  /** Extra recipients beyond primary/billing (role=technical). */
  extraContacts?: Array<{
    name: string;
    email: string;
    receiveInvoices?: boolean;
    receiveDigests?: boolean;
  }>;
  primaryDomain: string;
  planCode: string;
  setupFeeCents: number;
  /** Override catalog plan price (cents). Omit to use catalog. */
  monthlyCentsOverride?: number;
  /** Days after invoice issue until due. Default 7. Kept for legacy; due date prefers billingDay. */
  paymentDueDays?: number;
  /** Day of month (1–28) they are billed. Default 1. */
  billingDay?: number;
  host?: string;
  actor: string;
};

function assertPaymentDueDays(days: number): number {
  if (!Number.isInteger(days) || days < 0 || days > 90) {
    throw new Error("Payment due days must be an integer from 0 to 90");
  }
  return days;
}

function assertBillingDay(day: number): number {
  if (!Number.isInteger(day) || day < 1 || day > 28) {
    throw new Error("Billing day must be an integer from 1 to 28");
  }
  return day;
}

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
): Promise<
  RowDataPacket & {
    id: number;
    slug: string;
    status: TenantStatus;
    legal_name: string;
    trading_name: string;
  }
> {
  const [rows] = await conn.execute<RowDataPacket[]>(
    `SELECT id, slug, status, legal_name, trading_name FROM tenants WHERE slug = ? LIMIT 1`,
    [slug],
  );
  const row = rows[0] as
    | (RowDataPacket & {
        id: number;
        slug: string;
        status: TenantStatus;
        legal_name: string;
        trading_name: string;
      })
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
    const [serverRows] = await conn.execute<
      (RowDataPacket & { id: number })[]
    >(`SELECT id FROM servers WHERE name = ? LIMIT 1`, [host]);
    const serverId = Number(serverRows[0]?.id);
    if (!Number.isFinite(serverId) || serverId <= 0) {
      throw new Error(
        `Server "${host}" is not registered — add it under /servers first`,
      );
    }

    const catalogCents = await getPlanCents(conn, input.planCode);
    const monthlyCents =
      input.monthlyCentsOverride !== undefined
        ? input.monthlyCentsOverride
        : catalogCents;
    if (!Number.isInteger(monthlyCents) || monthlyCents < 0) {
      throw new Error("Monthly price must be a non-negative integer (cents)");
    }
    const paymentDueDays = assertPaymentDueDays(
      input.paymentDueDays !== undefined ? input.paymentDueDays : 7,
    );
    const billingDay = assertBillingDay(
      input.billingDay !== undefined ? input.billingDay : 1,
    );

    const [tenantResult] = await conn.execute<ResultSetHeader>(
      `INSERT INTO tenants
         (server_id, slug, legal_name, trading_name, status, payment_due_days, billing_day)
       VALUES (?, ?, ?, ?, 'prospect', ?, ?)`,
      [
        serverId,
        slug,
        input.legalName.trim(),
        input.tradingName.trim(),
        paymentDueDays,
        billingDay,
      ],
    );
    const tenantId = Number(tenantResult.insertId);

    await conn.execute(
      `INSERT INTO tenant_contacts
         (tenant_id, name, email, phone, role, is_primary, receive_invoices, receive_digests)
       VALUES (?, ?, ?, ?, 'primary', 1, ?, ?)`,
      [
        tenantId,
        input.primaryContact.name.trim(),
        input.primaryContact.email.trim().toLowerCase(),
        input.primaryContact.phone?.trim() || null,
        input.primaryContact.receiveInvoices ? 1 : 0,
        input.primaryContact.receiveDigests ? 1 : 0,
      ],
    );

    await conn.execute(
      `INSERT INTO tenant_contacts
         (tenant_id, name, email, phone, role, is_primary, receive_invoices, receive_digests)
       VALUES (?, ?, ?, ?, 'billing', 0, ?, ?)`,
      [
        tenantId,
        input.billingContact.name.trim(),
        input.billingContact.email.trim().toLowerCase(),
        input.billingContact.phone?.trim() || null,
        input.billingContact.receiveInvoices ? 1 : 0,
        input.billingContact.receiveDigests ? 1 : 0,
      ],
    );

    for (const extra of input.extraContacts ?? []) {
      const email = extra.email.trim().toLowerCase();
      if (!email.includes("@")) continue;
      await conn.execute(
        `INSERT INTO tenant_contacts
           (tenant_id, name, email, phone, role, is_primary, receive_invoices, receive_digests)
         VALUES (?, ?, ?, NULL, 'technical', 0, ?, ?)`,
        [
          tenantId,
          extra.name.trim() || email,
          email,
          extra.receiveInvoices ? 1 : 0,
          extra.receiveDigests ? 1 : 0,
        ],
      );
    }

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
        catalog_monthly_cents: catalogCents,
        payment_due_days: paymentDueDays,
        billing_day: billingDay,
        setup_fee_cents: input.setupFeeCents,
        subscription_id: Number(subResult.insertId),
        tenant_id: tenantId,
      },
    });

    return { slug };
  });
}

export async function activateTenant(
  slug: string,
  actor: string,
): Promise<{ invoiceId: number | null; periodStart: string; periodEnd: string }> {
  const today = sastToday();
  const periodStart = firstDayOfThisMonth();
  const periodEnd = lastDayOfThisMonth();
  let tenantId = 0;

  await withTransaction(async (conn) => {
    const tenant = await loadTenant(conn, slug);
    if (tenant.status !== "prospect") {
      throw new Error("Only prospect tenants can be activated");
    }
    tenantId = tenant.id;

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
        signup_period_start: periodStart,
        signup_period_end: periodEnd,
      },
    });
  });

  // Invoice the calendar month they activate in (full month, no pro-rata).
  let invoiceId: number | null = null;
  try {
    const { generateInvoiceForTenant } = await import("@/lib/invoices/generate");
    const draft = await generateInvoiceForTenant(
      tenantId,
      periodStart,
      periodEnd,
      actor,
    );
    invoiceId = draft.invoiceId;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!msg.includes("already exists")) {
      throw err;
    }
  }

  return { invoiceId, periodStart, periodEnd };
}

export async function changePlan(
  slug: string,
  newPlanCode: string,
  actor: string,
  monthlyCentsOverride?: number,
): Promise<{ effectiveOn: string; endsOn: string }> {
  const endsOn = lastDayOfThisMonth();
  const effectiveOn = firstDayOfNextMonth();

  await withTransaction(async (conn) => {
    const tenant = await loadTenant(conn, slug);
    if (tenant.status === "offboarded") {
      throw new Error("Cannot change plan for an offboarded tenant");
    }
    if (tenant.status === "prospect") {
      throw new Error(
        "Use Change package on the Billing tab for prospects (applies immediately)",
      );
    }

    const catalogCents = await getPlanCents(conn, newPlanCode);
    const monthlyCents =
      monthlyCentsOverride !== undefined ? monthlyCentsOverride : catalogCents;
    if (!Number.isInteger(monthlyCents) || monthlyCents < 0) {
      throw new Error("Monthly price must be a non-negative integer (cents)");
    }
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

    // Never mutate the ending subscription's price. Schedule end-of-month.
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
        catalog_monthly_cents: catalogCents,
        started_on: effectiveOn,
        previous_ends_on: endsOn,
      },
    });
  });

  return { effectiveOn, endsOn };
}

/**
 * Immediately set package (plan + price) on the open subscription.
 * Use from Billing for corrections / prospect setup. Rebuilds draft invoices.
 */
export async function setTenantPackage(
  slug: string,
  planCode: string,
  actor: string,
  monthlyCentsOverride?: number,
): Promise<{
  previousPlan: string;
  previousCents: number;
  monthlyCents: number;
  draftsRebuilt: number;
}> {
  const result = await withTransaction(async (conn) => {
    const tenant = await loadTenant(conn, slug);
    if (tenant.status === "offboarded") {
      throw new Error("Cannot change package for an offboarded tenant");
    }

    const catalogCents = await getPlanCents(conn, planCode);
    const monthlyCents =
      monthlyCentsOverride !== undefined ? monthlyCentsOverride : catalogCents;
    if (!Number.isInteger(monthlyCents) || monthlyCents < 0) {
      throw new Error("Monthly price must be a non-negative integer (cents)");
    }

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
         AND ends_on IS NULL
       ORDER BY id DESC
       LIMIT 1`,
      [tenant.id],
    );
    const current = subs[0];
    if (!current) throw new Error("No open subscription");

    const previousPlan = current.plan_code;
    const previousCents = Number(current.current_monthly_cents);
    if (previousPlan === planCode && previousCents === monthlyCents) {
      throw new Error("Package and price are already set to those values");
    }

    await conn.execute(
      `UPDATE subscriptions
       SET plan_code = ?, current_monthly_cents = ?
       WHERE id = ?`,
      [planCode, monthlyCents, current.id],
    );

    await writeAuditLog(conn, {
      actor,
      action: "subscription.set_package",
      entityType: "subscription",
      entityId: Number(current.id),
      before: {
        tenant_id: tenant.id,
        slug,
        plan_code: previousPlan,
        current_monthly_cents: previousCents,
      },
      after: {
        tenant_id: tenant.id,
        slug,
        plan_code: planCode,
        current_monthly_cents: monthlyCents,
        catalog_monthly_cents: catalogCents,
      },
    });

    return {
      previousPlan,
      previousCents,
      monthlyCents,
      tenantId: tenant.id,
    };
  });

  const { rebuildTenantDraftInvoices } = await import("@/lib/invoices/generate");
  const draftsRebuilt = await rebuildTenantDraftInvoices(
    result.tenantId,
    actor,
  );

  return {
    previousPlan: result.previousPlan,
    previousCents: result.previousCents,
    monthlyCents: result.monthlyCents,
    draftsRebuilt,
  };
}

/**
 * Set the billed monthly package price on the active subscription.
 * Used for discounts / custom pricing. Affects the next invoice generated
 * (no pro-rata — mid-cycle changes apply from the next billing run).
 */
export async function adjustSubscriptionPrice(
  slug: string,
  monthlyCents: number,
  actor: string,
  note?: string,
): Promise<{ subscriptionId: number; previousCents: number; draftsRebuilt: number }> {
  if (!Number.isInteger(monthlyCents) || monthlyCents < 0) {
    throw new Error("Monthly price must be a non-negative integer (cents)");
  }

  const result = await withTransaction(async (conn) => {
    const tenant = await loadTenant(conn, slug);
    if (tenant.status === "offboarded") {
      throw new Error("Cannot adjust price for an offboarded tenant");
    }

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
         AND (ends_on IS NULL OR ends_on >= ?)
       ORDER BY started_on DESC, id DESC
       LIMIT 1`,
      [tenant.id, today],
    );
    const current = subs[0];
    if (!current) throw new Error("No active subscription");

    const previousCents = Number(current.current_monthly_cents);
    if (previousCents === monthlyCents) {
      throw new Error("Price is already set to that amount");
    }

    await conn.execute(
      `UPDATE subscriptions SET current_monthly_cents = ? WHERE id = ?`,
      [monthlyCents, current.id],
    );

    await writeAuditLog(conn, {
      actor,
      action: "subscription.adjust_price",
      entityType: "subscription",
      entityId: Number(current.id),
      before: {
        tenant_id: tenant.id,
        slug,
        plan_code: current.plan_code,
        current_monthly_cents: previousCents,
      },
      after: {
        tenant_id: tenant.id,
        slug,
        plan_code: current.plan_code,
        current_monthly_cents: monthlyCents,
        note: note?.trim() || null,
      },
    });

    return {
      subscriptionId: Number(current.id),
      previousCents,
      tenantId: tenant.id,
    };
  });

  const { rebuildTenantDraftInvoices } = await import("@/lib/invoices/generate");
  const draftsRebuilt = await rebuildTenantDraftInvoices(
    result.tenantId,
    actor,
  );

  return {
    subscriptionId: result.subscriptionId,
    previousCents: result.previousCents,
    draftsRebuilt,
  };
}

/** Update payment terms (days after invoice issue until due). Applies to future issues. */
export async function setPaymentDueDays(
  slug: string,
  paymentDueDays: number,
  actor: string,
): Promise<{ previous: number }> {
  const days = assertPaymentDueDays(paymentDueDays);

  return withTransaction(async (conn) => {
    const tenant = await loadTenant(conn, slug);
    if (tenant.status === "offboarded") {
      throw new Error("Cannot change payment terms for an offboarded tenant");
    }

    const [rows] = await conn.execute<
      (RowDataPacket & { payment_due_days: number })[]
    >(`SELECT payment_due_days FROM tenants WHERE id = ? LIMIT 1`, [tenant.id]);
    const previous = Number(rows[0]?.payment_due_days ?? 7);
    if (previous === days) {
      throw new Error("Payment terms are already set to that value");
    }

    await conn.execute(
      `UPDATE tenants SET payment_due_days = ? WHERE id = ?`,
      [days, tenant.id],
    );

    await writeAuditLog(conn, {
      actor,
      action: "tenant.set_payment_due_days",
      entityType: "tenant",
      entityId: tenant.id,
      before: { slug, payment_due_days: previous },
      after: { slug, payment_due_days: days },
    });

    return { previous };
  });
}

/** Day of month (1–28) the customer is billed / invoice is due. */
export async function setBillingDay(
  slug: string,
  billingDay: number,
  actor: string,
): Promise<{ previous: number }> {
  const day = assertBillingDay(billingDay);

  return withTransaction(async (conn) => {
    const tenant = await loadTenant(conn, slug);
    if (tenant.status === "offboarded") {
      throw new Error("Cannot change billing day for an offboarded tenant");
    }

    const [rows] = await conn.execute<
      (RowDataPacket & { billing_day: number })[]
    >(`SELECT billing_day FROM tenants WHERE id = ? LIMIT 1`, [tenant.id]);
    const previous = Number(rows[0]?.billing_day ?? 1);
    if (previous === day) {
      throw new Error("Billing day is already set to that value");
    }

    await conn.execute(`UPDATE tenants SET billing_day = ? WHERE id = ?`, [
      day,
      tenant.id,
    ]);

    await writeAuditLog(conn, {
      actor,
      action: "tenant.set_billing_day",
      entityType: "tenant",
      entityId: tenant.id,
      before: { slug, billing_day: previous },
      after: { slug, billing_day: day },
    });

    return { previous };
  });
}

export async function updateTenantContact(
  slug: string,
  contactId: number,
  input: {
    name: string;
    email: string;
    phone: string | null;
    receiveInvoices?: boolean;
    receiveDigests?: boolean;
  },
  actor: string,
): Promise<void> {
  const name = input.name.trim();
  const email = input.email.trim().toLowerCase();
  const phone = input.phone?.trim() || null;
  if (!name) throw new Error("Contact name is required");
  if (!email || !email.includes("@")) throw new Error("Valid email is required");

  await withTransaction(async (conn) => {
    const tenant = await loadTenant(conn, slug);
    const [rows] = await conn.execute<
      (RowDataPacket & {
        id: number;
        name: string;
        email: string;
        phone: string | null;
        role: string;
        receive_invoices: number;
        receive_digests: number;
      })[]
    >(
      `SELECT id, name, email, phone, role, receive_invoices, receive_digests
       FROM tenant_contacts
       WHERE id = ? AND tenant_id = ? LIMIT 1`,
      [contactId, tenant.id],
    );
    const contact = rows[0];
    if (!contact) throw new Error("Contact not found");

    const receiveInvoices =
      input.receiveInvoices === undefined
        ? Number(contact.receive_invoices)
        : input.receiveInvoices
          ? 1
          : 0;
    const receiveDigests =
      input.receiveDigests === undefined
        ? Number(contact.receive_digests)
        : input.receiveDigests
          ? 1
          : 0;

    await conn.execute(
      `UPDATE tenant_contacts
       SET name = ?, email = ?, phone = ?,
           receive_invoices = ?, receive_digests = ?
       WHERE id = ?`,
      [name, email, phone, receiveInvoices, receiveDigests, contactId],
    );

    await writeAuditLog(conn, {
      actor,
      action: "tenant_contact.update",
      entityType: "tenant_contact",
      entityId: contactId,
      before: {
        slug,
        name: contact.name,
        email: contact.email,
        phone: contact.phone,
        role: contact.role,
        receive_invoices: Number(contact.receive_invoices),
        receive_digests: Number(contact.receive_digests),
      },
      after: {
        slug,
        name,
        email,
        phone,
        role: contact.role,
        receive_invoices: receiveInvoices,
        receive_digests: receiveDigests,
      },
    });
  });
}

export async function addTenantContact(
  slug: string,
  input: {
    name: string;
    email: string;
    phone?: string | null;
    receiveInvoices?: boolean;
    receiveDigests?: boolean;
  },
  actor: string,
): Promise<void> {
  const name = input.name.trim() || input.email.trim();
  const email = input.email.trim().toLowerCase();
  if (!email.includes("@")) throw new Error("Valid email is required");

  await withTransaction(async (conn) => {
    const tenant = await loadTenant(conn, slug);
    const [result] = await conn.execute<ResultSetHeader>(
      `INSERT INTO tenant_contacts
         (tenant_id, name, email, phone, role, is_primary, receive_invoices, receive_digests)
       VALUES (?, ?, ?, ?, 'technical', 0, ?, ?)`,
      [
        tenant.id,
        name,
        email,
        input.phone?.trim() || null,
        input.receiveInvoices ? 1 : 0,
        input.receiveDigests ? 1 : 0,
      ],
    );
    await writeAuditLog(conn, {
      actor,
      action: "tenant_contact.create",
      entityType: "tenant_contact",
      entityId: Number(result.insertId),
      after: {
        slug,
        name,
        email,
        receive_invoices: input.receiveInvoices ? 1 : 0,
        receive_digests: input.receiveDigests ? 1 : 0,
      },
    });
  });
}

export async function addAddon(
  slug: string,
  input: {
    description: string;
    kind: "recurring" | "once_off";
    amountCents: number;
  },
  actor: string,
): Promise<{ activeFrom: string; draftsRebuilt: number }> {
  if (!Number.isInteger(input.amountCents) || input.amountCents === 0) {
    throw new Error("Addon amount must be a non-zero integer (cents)");
  }
  const activeFrom =
    input.kind === "recurring" ? firstDayOfNextMonth() : sastToday();

  let tenantId = 0;

  await withTransaction(async (conn) => {
    const tenant = await loadTenant(conn, slug);
    if (tenant.status === "offboarded") {
      throw new Error("Cannot add addons to an offboarded tenant");
    }
    tenantId = tenant.id;

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

  const { rebuildTenantDraftInvoices } = await import("@/lib/invoices/generate");
  const draftsRebuilt = await rebuildTenantDraftInvoices(tenantId, actor);

  return { activeFrom, draftsRebuilt };
}

export async function removeAddon(
  slug: string,
  addonId: number,
  actor: string,
): Promise<{ activeUntil: string | null; draftsRebuilt: number }> {
  let activeUntil: string | null = null;
  let tenantId = 0;

  await withTransaction(async (conn) => {
    const tenant = await loadTenant(conn, slug);
    tenantId = tenant.id;
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

  const { rebuildTenantDraftInvoices } = await import("@/lib/invoices/generate");
  const draftsRebuilt = await rebuildTenantDraftInvoices(tenantId, actor);

  return { activeUntil, draftsRebuilt };
}

export type SuspendOptions = {
  reason: string;
  /** Must match tenant slug exactly (typed confirmation). */
  confirmSlug: string;
};

async function loadInfraForEnforce(
  conn: PoolConnection,
  tenantId: number,
): Promise<{
  primary_domain: string;
  extra_domains: string[];
  container_name: string;
}> {
  const [rows] = await conn.execute<
    (RowDataPacket & {
      primary_domain: string;
      extra_domains: string | null;
      container_name: string;
    })[]
  >(
    `SELECT primary_domain, extra_domains, container_name
     FROM tenant_infra WHERE tenant_id = ? LIMIT 1`,
    [tenantId],
  );
  const row = rows[0];
  if (!row) throw new Error("Tenant has no infra record — cannot enforce suspension");
  let extra: string[] = [];
  if (row.extra_domains) {
    try {
      const parsed = JSON.parse(
        typeof row.extra_domains === "string"
          ? row.extra_domains
          : JSON.stringify(row.extra_domains),
      );
      if (Array.isArray(parsed)) extra = parsed.map(String);
    } catch {
      extra = [];
    }
  }
  return {
    primary_domain: row.primary_domain,
    extra_domains: extra,
    container_name: row.container_name,
  };
}

/**
 * Manually suspend a tenant: Caddy holding page (storefront only; /admin exempt),
 * then status flag. Never stops containers. Billing continues.
 */
export async function suspendTenant(
  slug: string,
  actor: string,
  opts: SuspendOptions,
): Promise<void> {
  const reason = opts.reason.trim();
  if (!reason) throw new Error("Suspension reason is required");
  if (opts.confirmSlug.trim() !== slug) {
    throw new Error("Typed confirmation slug does not match");
  }

  const { enforceCaddySuspend, storefrontHosts } = await import(
    "@/lib/caddy/enforce"
  );

  // Read-only prep outside the mutation window
  const tenantRow = await withTransaction(async (conn) => {
    const tenant = await loadTenant(conn, slug);
    if (tenant.status !== "active") {
      throw new Error("Only active tenants can be suspended");
    }
    const infra = await loadInfraForEnforce(conn, tenant.id);
    return {
      id: tenant.id,
      slug: tenant.slug,
      trading_name: tenant.trading_name,
      infra,
    };
  });

  const caddy = await enforceCaddySuspend({
    slug: tenantRow.slug,
    tradingName: tenantRow.trading_name,
    hosts: storefrontHosts(
      tenantRow.infra.primary_domain,
      tenantRow.infra.extra_domains,
    ),
    containerName: tenantRow.infra.container_name,
    adminPaths: ["/admin*", "/api/admin*"],
  });

  try {
    await withTransaction(async (conn) => {
      const tenant = await loadTenant(conn, slug);
      if (tenant.status !== "active") {
        throw new Error("Only active tenants can be suspended");
      }
      await conn.execute(`UPDATE tenants SET status = 'suspended' WHERE id = ?`, [
        tenant.id,
      ]);
      // Suppress paging: close open alerts; suspend is intentional.
      await conn.execute(
        `UPDATE alert_states
         SET status = 'resolved', resolved_at = UTC_TIMESTAMP(3)
         WHERE tenant_id = ? AND status = 'open'`,
        [tenant.id],
      );
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
          reason,
          caddy_route: caddy.routeId,
          caddy_snapshot: caddy.snapshotPath,
          note: "Billing continues — storefront held via Caddy; admin path exempt",
        },
      });
    });
  } catch (err) {
    const { enforceCaddyUnsuspend, storefrontHosts: hostsFn } = await import(
      "@/lib/caddy/enforce"
    );
    try {
      await enforceCaddyUnsuspend({
        slug: tenantRow.slug,
        tradingName: tenantRow.trading_name,
        hosts: hostsFn(
          tenantRow.infra.primary_domain,
          tenantRow.infra.extra_domains,
        ),
        containerName: tenantRow.infra.container_name,
        adminPaths: ["/admin*", "/api/admin*"],
      });
    } catch (rollbackErr) {
      console.error(
        "[suspend] DB failed and Caddy rollback also failed:",
        rollbackErr,
      );
    }
    throw err;
  }
}

export async function unsuspendTenant(
  slug: string,
  actor: string,
  opts?: { reason?: string; notify?: boolean },
): Promise<void> {
  const { enforceCaddyUnsuspend, storefrontHosts } = await import(
    "@/lib/caddy/enforce"
  );

  const tenantRow = await withTransaction(async (conn) => {
    const tenant = await loadTenant(conn, slug);
    if (tenant.status !== "suspended") {
      throw new Error("Only suspended tenants can be unsuspended");
    }
    const infra = await loadInfraForEnforce(conn, tenant.id);
    return {
      id: tenant.id,
      slug: tenant.slug,
      trading_name: tenant.trading_name,
      infra,
    };
  });

  const caddy = await enforceCaddyUnsuspend({
    slug: tenantRow.slug,
    tradingName: tenantRow.trading_name,
    hosts: storefrontHosts(
      tenantRow.infra.primary_domain,
      tenantRow.infra.extra_domains,
    ),
    containerName: tenantRow.infra.container_name,
    adminPaths: ["/admin*", "/api/admin*"],
  });

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
      after: {
        status: "active",
        slug,
        tenant_id: tenant.id,
        reason: opts?.reason ?? null,
        caddy_route: caddy.routeId,
        caddy_snapshot: caddy.snapshotPath,
      },
    });
  });

  if (opts?.notify) {
    const { notifyAll } = await import("@/lib/notify");
    await notifyAll({
      subject: `[unsuspend] ${tenantRow.trading_name} (${tenantRow.slug}) is back online`,
      body: [
        `Tenant ${tenantRow.trading_name} (${tenantRow.slug}) was automatically unsuspended.`,
        opts.reason ?? "Outstanding balance cleared.",
        "Storefront holding page removed via Caddy.",
      ].join("\n"),
      severity: "info",
      tenantSlug: tenantRow.slug,
    });
  }
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
