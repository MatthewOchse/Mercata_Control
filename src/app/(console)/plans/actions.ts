"use server";

import { revalidatePath } from "next/cache";
import { requireOperator } from "@/lib/auth/server";
import { parseZARToCents } from "@/lib/money";
import { updatePlan } from "@/lib/plans/service";

export type PlanActionState = { error?: string; message?: string };

function parsePercent(raw: string): number {
  const cleaned = raw.trim().replace("%", "").replace(",", ".");
  if (cleaned === "") return 0;
  const pct = Number(cleaned);
  if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
    throw new Error("Commission must be a percentage between 0 and 100");
  }
  // 4 decimal places in the column — 2% stores as 0.0200.
  return Math.round((pct / 100) * 10000) / 10000;
}

export async function updatePlanAction(
  _prev: PlanActionState,
  formData: FormData,
): Promise<PlanActionState> {
  const operator = await requireOperator();
  const code = String(formData.get("code") ?? "").trim();
  if (!code) return { error: "Missing plan" };

  try {
    const thresholdRaw = String(formData.get("graduation_threshold") ?? "").trim();
    const graduateTo = String(formData.get("graduate_to_code") ?? "").trim();

    await updatePlan(
      {
        code,
        name: String(formData.get("name") ?? ""),
        monthlyCents: parseZARToCents(String(formData.get("monthly") ?? "0")),
        commissionRate: parsePercent(String(formData.get("commission") ?? "0")),
        graduationThresholdCents:
          thresholdRaw === "" ? null : parseZARToCents(thresholdRaw),
        graduateToCode: graduateTo === "" ? null : graduateTo,
        eligibility: String(formData.get("eligibility") ?? "").trim() || null,
        active: formData.get("active") === "on",
      },
      operator.email,
    );

    revalidatePath("/plans");
    revalidatePath("/billing/run");
    revalidatePath("/revenue");
    return {
      message: `${code} saved. Existing tenants keep the price they were sold — this changes defaults and commission policy only.`,
    };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Save failed" };
  }
}
