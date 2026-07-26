"use server";

import { revalidatePath } from "next/cache";
import { requireOperator } from "@/lib/auth/server";
import { writeAuditLog } from "@/lib/db/audit";
import { withTransaction } from "@/lib/db/pool";
import { sendInvoiceEmail } from "@/lib/invoices/delivery";
import { suspendTenant } from "@/lib/tenants/service";

export type DashActionState = { error?: string; message?: string };

export async function resendUnsentAction(
  invoiceId: number,
): Promise<DashActionState> {
  const operator = await requireOperator();
  try {
    const result = await sendInvoiceEmail(invoiceId, operator.email);
    revalidatePath("/");
    revalidatePath("/invoices");
    revalidatePath(`/invoices/${invoiceId}`);
    if (!result.sent) return { error: result.error };
    return { message: "Sent" };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Send failed" };
  }
}

export async function resolveTaskAction(
  taskId: number,
  resolution: "done" | "dismissed",
): Promise<DashActionState> {
  const operator = await requireOperator();
  try {
    await withTransaction(async (conn) => {
      await conn.execute(
        `UPDATE operator_tasks
         SET status = ?, resolved_at = UTC_TIMESTAMP(3), resolved_by = ?
         WHERE id = ? AND status = 'open'`,
        [resolution, operator.email, taskId],
      );
      await writeAuditLog(conn, {
        actor: operator.email,
        action: `task.${resolution}`,
        entityType: "operator_task",
        entityId: taskId,
      });
    });
    revalidatePath("/");
    return { message: resolution === "done" ? "Task done" : "Task dismissed" };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed" };
  }
}

export async function confirmSuspensionFromTaskAction(
  taskId: number,
  tenantSlug: string,
): Promise<DashActionState> {
  const operator = await requireOperator();
  try {
    await suspendTenant(tenantSlug, operator.email, {
      reason: "Confirmed from dunning suspension task",
      confirmSlug: tenantSlug,
    });
    await withTransaction(async (conn) => {
      await conn.execute(
        `UPDATE operator_tasks
         SET status = 'done', resolved_at = UTC_TIMESTAMP(3), resolved_by = ?
         WHERE id = ?`,
        [operator.email, taskId],
      );
    });
    revalidatePath("/");
    revalidatePath(`/tenants/${tenantSlug}`);
    revalidatePath("/health");
    return { message: `Suspended ${tenantSlug}` };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Suspend failed" };
  }
}
