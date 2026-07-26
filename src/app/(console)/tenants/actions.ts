"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireOperator } from "@/lib/auth/server";
import { formatZAR, parseZARToCents } from "@/lib/money";
import {
  activateTenant,
  addAddon,
  adjustSubscriptionPrice,
  changePlan,
  createTenant,
  offboardTenant,
  regenerateFleetSecret,
  removeAddon,
  setPaymentDueDays,
  setBillingDay,
  setTenantPackage,
  suspendTenant,
  unsuspendTenant,
  updateTenantContact,
  addTenantContact,
} from "@/lib/tenants/service";

export type ActionState = {
  error?: string;
  message?: string;
  effectiveOn?: string;
  plaintextSecret?: string;
};

function formStr(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

export async function createTenantAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const operator = await requireOperator();
  try {
    const setupRaw = formStr(formData, "setup_fee");
    const setupFeeCents =
      setupRaw === "" || setupRaw === "0" ? 0 : parseZARToCents(setupRaw);

    const priceRaw = formStr(formData, "monthly_price");
    const monthlyCentsOverride =
      priceRaw === "" ? undefined : parseZARToCents(priceRaw);

    const dueRaw = formStr(formData, "payment_due_days");
    const paymentDueDays =
      dueRaw === "" ? undefined : Number.parseInt(dueRaw, 10);
    const billingDayRaw = formStr(formData, "billing_day");
    const billingDay =
      billingDayRaw === "" ? undefined : Number.parseInt(billingDayRaw, 10);

    const primaryName = formStr(formData, "primary_name");
    const primaryEmail = formStr(formData, "primary_email");
    const billingSame = formData.get("billing_same") === "on";

    const extraEmails = formData.getAll("extra_email").map(String);
    const extraNames = formData.getAll("extra_name").map(String);
    const extraInvoice = formData.getAll("extra_receive_invoices").map(String);
    const extraDigest = formData.getAll("extra_receive_digests").map(String);
    const extraContacts = extraEmails
      .map((email, i) => ({
        name: (extraNames[i] ?? "").trim() || email.trim(),
        email: email.trim(),
        receiveInvoices: extraInvoice.includes(String(i)),
        receiveDigests: extraDigest.includes(String(i)),
      }))
      .filter((c) => c.email.includes("@"));

    const { slug } = await createTenant({
      legalName: formStr(formData, "legal_name"),
      tradingName: formStr(formData, "trading_name"),
      slug: formStr(formData, "slug"),
      primaryContact: {
        name: primaryName,
        email: primaryEmail,
        phone: formStr(formData, "primary_phone") || undefined,
        receiveInvoices: formData.get("primary_receive_invoices") === "on",
        receiveDigests: formData.get("primary_receive_digests") === "on",
      },
      billingContact: billingSame
        ? {
            name: primaryName,
            email: primaryEmail,
            phone: formStr(formData, "primary_phone") || undefined,
            receiveInvoices: formData.get("billing_receive_invoices") === "on",
            receiveDigests: formData.get("billing_receive_digests") === "on",
          }
        : {
            name: formStr(formData, "billing_name"),
            email: formStr(formData, "billing_email"),
            phone: formStr(formData, "billing_phone") || undefined,
            receiveInvoices: formData.get("billing_receive_invoices") === "on",
            receiveDigests: formData.get("billing_receive_digests") === "on",
          },
      extraContacts,
      primaryDomain: formStr(formData, "primary_domain"),
      planCode: formStr(formData, "plan_code"),
      setupFeeCents,
      monthlyCentsOverride,
      paymentDueDays,
      billingDay,
      actor: operator.email,
    });

    revalidatePath("/tenants");
    redirect(`/tenants/${slug}`);
  } catch (err) {
    if (isNextRedirect(err)) throw err;
    return { error: err instanceof Error ? err.message : "Create failed" };
  }
}

export async function activateTenantAction(
  slug: string,
): Promise<ActionState> {
  const operator = await requireOperator();
  try {
    const result = await activateTenant(slug, operator.email);
    revalidatePath(`/tenants/${slug}`);
    revalidatePath("/tenants");
    revalidatePath("/billing/run");
    revalidatePath("/invoices");
    return {
      message: result.invoiceId
        ? `Tenant activated. Draft invoice created for ${result.periodStart} → ${result.periodEnd}.`
        : "Tenant activated (signup-month invoice already existed).",
    };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Activate failed" };
  }
}

export async function changePlanAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const operator = await requireOperator();
  const slug = formStr(formData, "slug");
  try {
    const priceRaw = formStr(formData, "monthly_price");
    const monthlyOverride =
      priceRaw === "" ? undefined : parseZARToCents(priceRaw);
    const result = await changePlan(
      slug,
      formStr(formData, "plan_code"),
      operator.email,
      monthlyOverride,
    );
    revalidatePath(`/tenants/${slug}`);
    revalidatePath("/tenants");
    return {
      message: `Plan change scheduled. Current plan ends ${result.endsOn}; new plan starts ${result.effectiveOn}.`,
      effectiveOn: result.effectiveOn,
    };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Plan change failed" };
  }
}

export async function setTenantPackageAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const operator = await requireOperator();
  const slug = formStr(formData, "slug");
  try {
    const result = await setTenantPackage(
      slug,
      formStr(formData, "plan_code"),
      operator.email,
    );
    revalidatePath(`/tenants/${slug}`);
    revalidatePath("/tenants");
    revalidatePath("/billing/run");
    return {
      message: `Package updated to ${formStr(formData, "plan_code")} at ${formatZAR(result.monthlyCents)}/mo${
        result.draftsRebuilt
          ? ` — refreshed ${result.draftsRebuilt} draft(s)`
          : ""
      }.`,
    };
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "Package change failed",
    };
  }
}

export async function adjustSubscriptionPriceAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const operator = await requireOperator();
  const slug = formStr(formData, "slug");
  try {
    const monthlyCents = parseZARToCents(formStr(formData, "monthly_price"));
    const note = formStr(formData, "note") || undefined;
    const result = await adjustSubscriptionPrice(
      slug,
      monthlyCents,
      operator.email,
      note,
    );
    revalidatePath(`/tenants/${slug}`);
    revalidatePath("/tenants");
    revalidatePath("/billing/run");
    return {
      message: `Package price updated from ${formatZAR(result.previousCents)} to ${formatZAR(monthlyCents)}/mo (applies on next invoice).`,
    };
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "Price adjust failed",
    };
  }
}

export async function setPaymentDueDaysAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const operator = await requireOperator();
  const slug = formStr(formData, "slug");
  try {
    const days = Number.parseInt(formStr(formData, "payment_due_days"), 10);
    if (!Number.isFinite(days)) {
      throw new Error("Payment due days is required");
    }
    const result = await setPaymentDueDays(slug, days, operator.email);
    revalidatePath(`/tenants/${slug}`);
    return {
      message: `Payment terms updated from ${result.previous} to ${days} day(s) after invoice (future invoices only).`,
    };
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "Payment terms update failed",
    };
  }
}

export async function setBillingDayAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const operator = await requireOperator();
  const slug = formStr(formData, "slug");
  try {
    const day = Number.parseInt(formStr(formData, "billing_day"), 10);
    if (!Number.isFinite(day)) {
      throw new Error("Billing day is required");
    }
    const result = await setBillingDay(slug, day, operator.email);
    revalidatePath(`/tenants/${slug}`);
    return {
      message: `Billing day updated from ${result.previous} to ${day} (applies to newly issued invoices).`,
    };
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "Billing day update failed",
    };
  }
}

export async function addAddonAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const operator = await requireOperator();
  const slug = formStr(formData, "slug");
  try {
    const amountCents = parseZARToCents(formStr(formData, "amount"));
    const kind = formStr(formData, "kind") as "recurring" | "once_off";
    const result = await addAddon(
      slug,
      {
        description: formStr(formData, "description"),
        kind,
        amountCents,
      },
      operator.email,
    );
    revalidatePath(`/tenants/${slug}`);
    return {
      message: `Expense added (active from ${result.activeFrom})${
        result.draftsRebuilt
          ? ` — refreshed ${result.draftsRebuilt} draft invoice(s)`
          : ""
      }`,
    };
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "Add expense failed",
    };
  }
}

export async function removeAddonAction(
  slug: string,
  addonId: number,
): Promise<ActionState> {
  const operator = await requireOperator();
  try {
    const result = await removeAddon(slug, addonId, operator.email);
    revalidatePath(`/tenants/${slug}`);
    return {
      message: result.activeUntil
        ? `Expense ends ${result.activeUntil}${
            result.draftsRebuilt
              ? ` — refreshed ${result.draftsRebuilt} draft(s)`
              : ""
          }`
        : "Expense removed",
    };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Remove addon failed" };
  }
}

export async function suspendTenantAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const operator = await requireOperator();
  const slug = formStr(formData, "slug");
  try {
    await suspendTenant(slug, operator.email, {
      reason: formStr(formData, "reason"),
      confirmSlug: formStr(formData, "confirm_slug"),
    });
    revalidatePath(`/tenants/${slug}`);
    revalidatePath("/tenants");
    revalidatePath("/health");
    return { message: "Tenant suspended — storefront held; billing continues" };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Suspend failed" };
  }
}

export async function unsuspendTenantAction(
  slug: string,
): Promise<ActionState> {
  const operator = await requireOperator();
  try {
    await unsuspendTenant(slug, operator.email, {
      reason: "Manual unsuspend",
    });
    revalidatePath(`/tenants/${slug}`);
    revalidatePath("/tenants");
    revalidatePath("/health");
    return { message: "Tenant unsuspended — storefront restored" };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Unsuspend failed" };
  }
}

export async function regenerateSecretAction(
  slug: string,
): Promise<ActionState> {
  const operator = await requireOperator();
  try {
    const plaintext = await regenerateFleetSecret(slug, operator.email);
    revalidatePath(`/tenants/${slug}`);
    return {
      message: "Fleet secret regenerated — copy it now; it will not be shown again.",
      plaintextSecret: plaintext,
    };
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "Regenerate failed",
    };
  }
}

export async function offboardTenantAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const operator = await requireOperator();
  const slug = formStr(formData, "slug");
  try {
    const bundle = await offboardTenant(
      slug,
      formStr(formData, "confirm_slug"),
      operator.email,
    );
    revalidatePath(`/tenants/${slug}`);
    revalidatePath("/tenants");
    // Stash export in a short-lived cookie-free redirect via query is too large —
    // write to /tmp and redirect to download route.
    const { writeFile, mkdir } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const dir = join(process.cwd(), ".data", "exports");
    await mkdir(dir, { recursive: true });
    const base = join(dir, bundle.filenameBase);
    await writeFile(`${base}.json`, bundle.json, "utf8");
    await writeFile(`${base}.csv`, bundle.csv, "utf8");
    redirect(
      `/tenants/${slug}/export?base=${encodeURIComponent(bundle.filenameBase)}`,
    );
  } catch (err) {
    if (isNextRedirect(err)) throw err;
    return { error: err instanceof Error ? err.message : "Offboard failed" };
  }
}

export async function updateDigestSettingsAction(
  slug: string,
  formData: FormData,
): Promise<ActionState> {
  await requireOperator();
  try {
    const cadence = formStr(formData, "digest_cadence") as
      | "daily"
      | "weekly"
      | "monthly"
      | "off";
    if (!["daily", "weekly", "monthly", "off"].includes(cadence)) {
      return { error: "Invalid cadence" };
    }
    const digestDay = Number(formStr(formData, "digest_day") || "1");
    const ga4 = formStr(formData, "ga4_property_id") || null;
    let primary = formStr(formData, "brand_primary_color") || null;
    if (primary && !/^#?[0-9A-Fa-f]{6}$/.test(primary)) {
      return { error: "Brand colour must be a 6-digit hex" };
    }
    if (primary && !primary.startsWith("#")) primary = `#${primary}`;
    const logo = formStr(formData, "brand_logo_url") || null;

    const { updateDigestSettings } = await import("@/lib/digest/send");
    await updateDigestSettings({
      slug,
      cadence,
      digestDay,
      ga4PropertyId: ga4,
      brandPrimaryColor: primary,
      brandLogoUrl: logo,
    });
    revalidatePath(`/tenants/${slug}`);
    return { message: "Digest settings saved" };
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "Save failed",
    };
  }
}

export async function testGa4ConnectionAction(
  slug: string,
  formData: FormData,
): Promise<ActionState> {
  const operator = await requireOperator();
  try {
    const propertyId =
      formStr(formData, "ga4_property_id") ||
      formStr(formData, "property_id");
    if (!propertyId) return { error: "Enter a GA4 property ID first" };
    const { getTenantBySlug } = await import("@/lib/tenants/queries");
    const tenant = await getTenantBySlug(slug);
    if (!tenant) return { error: "Tenant not found" };
    const { testAndStoreGa4Connection } = await import("@/lib/analytics/etl");
    const result = await testAndStoreGa4Connection({
      tenantId: tenant.id,
      slug,
      propertyId,
      actor: operator.email,
    });
    revalidatePath(`/tenants/${slug}`);
    return { message: `Connected: ${result.displayName}` };
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "GA4 connection failed",
    };
  }
}

export async function sendTestDigestAction(
  slug: string,
): Promise<ActionState> {
  const operator = await requireOperator();
  try {
    const { sendTestDigest } = await import("@/lib/digest/send");
    const result = await sendTestDigest({
      slug,
      to: operator.email,
    });
    return { message: `Test sent to ${operator.email}: ${result.subject}` };
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "Test send failed",
    };
  }
}

export async function updateContactAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const operator = await requireOperator();
  const slug = formStr(formData, "slug");
  try {
    await updateTenantContact(
      slug,
      Number(formData.get("contact_id")),
      {
        name: formStr(formData, "name"),
        email: formStr(formData, "email"),
        phone: formStr(formData, "phone") || null,
        receiveInvoices: formData.get("receive_invoices") === "on",
        receiveDigests: formData.get("receive_digests") === "on",
      },
      operator.email,
    );
    revalidatePath(`/tenants/${slug}`);
    return { message: "Contact updated" };
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "Update failed",
    };
  }
}

export async function addContactAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const operator = await requireOperator();
  const slug = formStr(formData, "slug");
  try {
    await addTenantContact(
      slug,
      {
        name: formStr(formData, "name"),
        email: formStr(formData, "email"),
        phone: formStr(formData, "phone") || null,
        receiveInvoices: formData.get("receive_invoices") === "on",
        receiveDigests: formData.get("receive_digests") === "on",
      },
      operator.email,
    );
    revalidatePath(`/tenants/${slug}`);
    return { message: "Contact added" };
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "Add contact failed",
    };
  }
}

function isNextRedirect(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "digest" in err &&
    typeof (err as { digest?: string }).digest === "string" &&
    (err as { digest: string }).digest.startsWith("NEXT_REDIRECT")
  );
}
