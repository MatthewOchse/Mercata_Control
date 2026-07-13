"use server";

import { revalidatePath } from "next/cache";
import { requireOperator } from "@/lib/auth/server";
import {
  deleteDraftInvoice,
  generateInvoiceForTenant,
} from "@/lib/invoices/generate";
import {
  issueCreditNote,
  issueInvoice,
  markInvoiceOverdue,
  markInvoicePaid,
  voidInvoice,
} from "@/lib/invoices/issue";
import { comingBillingPeriod } from "@/lib/invoices/period";
import { previewBillingRun } from "@/lib/invoices/queries";

export type ActionState = { error?: string; message?: string };

export async function generateDraftsForPeriodAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const operator = await requireOperator();
  const periodStart = String(formData.get("period_start") ?? "");
  const periodEnd = String(formData.get("period_end") ?? "");
  if (!periodStart || !periodEnd) {
    return { error: "Period required" };
  }

  try {
    const preview = await previewBillingRun(periodStart, periodEnd);
    const toGenerate = preview.filter((r) => r.existingInvoiceId === null);
    let ok = 0;
    const errors: string[] = [];
    for (const row of toGenerate) {
      try {
        await generateInvoiceForTenant(
          row.tenantId,
          periodStart,
          periodEnd,
          operator.email,
        );
        ok++;
      } catch (err) {
        errors.push(
          `${row.slug}: ${err instanceof Error ? err.message : "failed"}`,
        );
      }
    }
    revalidatePath("/billing/run");
    revalidatePath("/invoices");
    if (errors.length) {
      return {
        error: `Generated ${ok}. Errors: ${errors.join("; ")}`,
      };
    }
    return { message: `Created ${ok} draft invoice(s). Review, then issue.` };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Generate failed" };
  }
}

export async function issuePeriodDraftsAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const operator = await requireOperator();
  const periodStart = String(formData.get("period_start") ?? "");
  const periodEnd = String(formData.get("period_end") ?? "");
  const confirmed = formData.get("confirm_issue") === "on";
  if (!confirmed) {
    return { error: "Tick the confirmation box — invoices are never auto-issued." };
  }

  try {
    const preview = await previewBillingRun(periodStart, periodEnd);
    const drafts = preview.filter((r) => r.existingStatus === "draft");
    let ok = 0;
    let unsent = 0;
    const errors: string[] = [];
    for (const row of drafts) {
      if (!row.existingInvoiceId) continue;
      try {
        const result = await issueInvoice(row.existingInvoiceId, operator.email);
        ok++;
        if (!result.emailed) {
          unsent++;
          errors.push(
            `${row.slug}: issued ${result.invoiceNumber} but UNSENT — ${result.emailError ?? "email failed"}`,
          );
        }
      } catch (err) {
        errors.push(
          `${row.slug}: ${err instanceof Error ? err.message : "failed"}`,
        );
      }
    }
    revalidatePath("/billing/run");
    revalidatePath("/invoices");
    revalidatePath("/");
    if (unsent > 0 || errors.length) {
      return {
        error: `Issued ${ok} (${unsent} unsent). ${errors.join("; ")}`,
      };
    }
    return {
      message: `Issued ${ok} invoice(s) and emailed billing contacts.`,
    };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Issue failed" };
  }
}

export async function issueOneAction(invoiceId: number): Promise<ActionState> {
  const operator = await requireOperator();
  try {
    const result = await issueInvoice(invoiceId, operator.email);
    revalidatePath("/invoices");
    revalidatePath(`/invoices/${invoiceId}`);
    revalidatePath("/billing/run");
    revalidatePath("/");
    if (!result.emailed) {
      return {
        error: `Issued ${result.invoiceNumber} but EMAIL FAILED — invoice is unsent. ${result.emailError ?? ""}`.trim(),
      };
    }
    return {
      message: `Issued ${result.invoiceNumber} and emailed billing contact`,
    };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Issue failed" };
  }
}

export async function resendInvoiceEmailAction(
  invoiceId: number,
): Promise<ActionState> {
  const operator = await requireOperator();
  try {
    const { sendInvoiceEmail } = await import("@/lib/invoices/delivery");
    const result = await sendInvoiceEmail(invoiceId, operator.email);
    revalidatePath(`/invoices/${invoiceId}`);
    revalidatePath("/invoices");
    revalidatePath("/");
    if (!result.sent) {
      return { error: `Send failed: ${result.error}` };
    }
    return { message: "Invoice emailed to billing contact" };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Send failed" };
  }
}

export async function deleteDraftAction(invoiceId: number): Promise<ActionState> {
  const operator = await requireOperator();
  try {
    await deleteDraftInvoice(invoiceId, operator.email);
    revalidatePath("/invoices");
    revalidatePath("/billing/run");
    return { message: "Draft deleted" };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Delete failed" };
  }
}

export async function creditNoteAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const operator = await requireOperator();
  const invoiceId = Number(formData.get("invoice_id"));
  const reason = String(formData.get("reason") ?? "").trim();
  const replacement = formData.get("replacement") === "on";
  if (!reason) return { error: "Reason is required" };
  try {
    const result = await issueCreditNote({
      invoiceId,
      reason,
      actor: operator.email,
      generateReplacementDraft: replacement,
    });
    revalidatePath("/invoices");
    revalidatePath(`/invoices/${invoiceId}`);
    if (result.replacementInvoiceId) {
      revalidatePath(`/invoices/${result.replacementInvoiceId}`);
    }
    return {
      message: `Credit note ${result.creditNoteNumber} issued.${
        result.replacementInvoiceId
          ? ` Replacement draft #${result.replacementInvoiceId} created.`
          : ""
      }`,
    };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Credit note failed" };
  }
}

export async function markPaidAction(invoiceId: number): Promise<ActionState> {
  const operator = await requireOperator();
  try {
    await markInvoicePaid(invoiceId, operator.email);
    revalidatePath(`/invoices/${invoiceId}`);
    revalidatePath("/invoices");
    return { message: "Marked paid" };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed" };
  }
}

export async function markOverdueAction(invoiceId: number): Promise<ActionState> {
  const operator = await requireOperator();
  try {
    await markInvoiceOverdue(invoiceId, operator.email);
    revalidatePath(`/invoices/${invoiceId}`);
    revalidatePath("/invoices");
    return { message: "Marked overdue" };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed" };
  }
}

export async function voidAction(invoiceId: number): Promise<ActionState> {
  const operator = await requireOperator();
  try {
    await voidInvoice(invoiceId, operator.email);
    revalidatePath(`/invoices/${invoiceId}`);
    revalidatePath("/invoices");
    return { message: "Voided (number retained)" };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed" };
  }
}

export async function defaultComingPeriod(): Promise<{
  periodStart: string;
  periodEnd: string;
}> {
  return comingBillingPeriod();
}
