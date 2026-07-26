"use server";

import { revalidatePath } from "next/cache";
import { requireOperator } from "@/lib/auth/server";
import {
  dismissGraduationFlag,
  markGraduated,
} from "@/lib/billing/graduation";
import { changePlan } from "@/lib/tenants/service";

export type GraduationActionState = { error?: string; message?: string };

export async function dismissGraduationAction(
  flagId: number,
): Promise<GraduationActionState> {
  const operator = await requireOperator();
  try {
    await dismissGraduationFlag(flagId, operator.email);
    revalidatePath("/");
    return { message: "Graduation suggestion dismissed" };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed" };
  }
}

/**
 * Move a flagged tenant onto the flat tier. Deliberately operator-initiated:
 * the monitor only ever suggests. `changePlan` ends the current subscription at
 * month end and starts the new one on the 1st, so nothing is backdated and no
 * existing invoice changes.
 */
export async function graduateTenantAction(opts: {
  flagId: number;
  slug: string;
  fromPlanCode: string;
  toPlanCode: string;
}): Promise<GraduationActionState> {
  const operator = await requireOperator();
  try {
    const { effectiveOn } = await changePlan(
      opts.slug,
      opts.toPlanCode,
      operator.email,
    );
    await markGraduated({
      flagId: opts.flagId,
      actor: operator.email,
      fromPlanCode: opts.fromPlanCode,
      toPlanCode: opts.toPlanCode,
      effectiveOn,
    });
    revalidatePath("/");
    revalidatePath(`/tenants/${opts.slug}`);
    revalidatePath("/billing/run");
    return {
      message: `Moved to ${opts.toPlanCode}, effective ${effectiveOn}. Existing invoices are unchanged.`,
    };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed" };
  }
}
