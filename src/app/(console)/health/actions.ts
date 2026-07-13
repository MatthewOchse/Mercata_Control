"use server";

import { revalidatePath } from "next/cache";
import { requireOperator } from "@/lib/auth/server";
import { silenceTenantForHours } from "@/lib/health/alerts";
import { runHealthPollCycle } from "@/lib/health/poller";

export type HealthActionState = { error?: string; message?: string };

export async function silenceOneHourAction(
  tenantId: number,
): Promise<HealthActionState> {
  const operator = await requireOperator();
  try {
    await silenceTenantForHours(
      tenantId,
      1,
      "Silence for 1 hour (deploy)",
      operator.email,
    );
    revalidatePath("/health");
    return { message: "Silenced for 1 hour" };
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "Silence failed",
    };
  }
}

export async function runPollNowAction(): Promise<HealthActionState> {
  await requireOperator();
  try {
    const summary = await runHealthPollCycle();
    revalidatePath("/health");
    return {
      message: `Polled ${summary.tenants} — ok ${summary.healthy}, failed ${summary.failed}`,
    };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Poll failed" };
  }
}
