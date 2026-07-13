"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireOperator } from "@/lib/auth/server";
import { parseZARToCents } from "@/lib/money";
import {
  activateTenant,
  addAddon,
  changePlan,
  createTenant,
  offboardTenant,
  regenerateFleetSecret,
  removeAddon,
  suspendTenant,
  unsuspendTenant,
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

    const primaryName = formStr(formData, "primary_name");
    const primaryEmail = formStr(formData, "primary_email");
    const billingSame = formData.get("billing_same") === "on";

    const { slug } = await createTenant({
      legalName: formStr(formData, "legal_name"),
      tradingName: formStr(formData, "trading_name"),
      slug: formStr(formData, "slug"),
      primaryContact: {
        name: primaryName,
        email: primaryEmail,
        phone: formStr(formData, "primary_phone") || undefined,
      },
      billingContact: billingSame
        ? {
            name: primaryName,
            email: primaryEmail,
            phone: formStr(formData, "primary_phone") || undefined,
          }
        : {
            name: formStr(formData, "billing_name"),
            email: formStr(formData, "billing_email"),
            phone: formStr(formData, "billing_phone") || undefined,
          },
      primaryDomain: formStr(formData, "primary_domain"),
      planCode: formStr(formData, "plan_code"),
      setupFeeCents,
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
    await activateTenant(slug, operator.email);
    revalidatePath(`/tenants/${slug}`);
    revalidatePath("/tenants");
    return { message: "Tenant activated" };
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
    const result = await changePlan(
      slug,
      formStr(formData, "plan_code"),
      operator.email,
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
      message: `Addon added (active from ${result.activeFrom})`,
    };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Add addon failed" };
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
        ? `Addon ends ${result.activeUntil}`
        : "Addon removed",
    };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Remove addon failed" };
  }
}

export async function suspendTenantAction(slug: string): Promise<ActionState> {
  const operator = await requireOperator();
  try {
    await suspendTenant(slug, operator.email);
    revalidatePath(`/tenants/${slug}`);
    revalidatePath("/tenants");
    return { message: "Tenant suspended — billing continues" };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Suspend failed" };
  }
}

export async function unsuspendTenantAction(
  slug: string,
): Promise<ActionState> {
  const operator = await requireOperator();
  try {
    await unsuspendTenant(slug, operator.email);
    revalidatePath(`/tenants/${slug}`);
    revalidatePath("/tenants");
    return { message: "Tenant unsuspended" };
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
      | "off";
    if (!["daily", "weekly", "off"].includes(cadence)) {
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

function isNextRedirect(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "digest" in err &&
    typeof (err as { digest?: string }).digest === "string" &&
    (err as { digest: string }).digest.startsWith("NEXT_REDIRECT")
  );
}
