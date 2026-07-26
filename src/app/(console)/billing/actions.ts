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

/** Re-read gross sales from every commission tenant, then rebuild their drafts. */
export async function refreshSalesForPeriodAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const operator = await requireOperator();
  const periodStart = String(formData.get("period_start") ?? "");
  const periodEnd = String(formData.get("period_end") ?? "");
  if (!periodStart || !periodEnd) return { error: "Period required" };

  try {
    const { rebuildDraftInvoice } = await import("@/lib/invoices/generate");
    const { getTenantGrossSales } = await import("@/lib/sales/gross-sales");
    const { previousSastMonth, sastMonthFromIso } = await import(
      "@/lib/sales/period"
    );

    const salesMonth = previousSastMonth(sastMonthFromIso(periodStart));
    const preview = await previewBillingRun(periodStart, periodEnd);
    const commissionRows = preview.filter((r) => r.commissionRate > 0);

    let ok = 0;
    let rebuilt = 0;
    const errors: string[] = [];

    for (const row of commissionRows) {
      const sales = await getTenantGrossSales(
        row.tenantId,
        salesMonth.year,
        salesMonth.month,
      );
      if (sales.ok) {
        ok++;
      } else {
        errors.push(`${row.slug}: ${sales.error}`);
      }
      // Only auto drafts are rebuilt; issued invoices are immutable and manual
      // drafts are hand-edited, so both are left alone.
      if (row.existingInvoiceId && row.existingStatus === "draft") {
        try {
          await rebuildDraftInvoice(row.existingInvoiceId, operator.email);
          rebuilt++;
        } catch (err) {
          errors.push(
            `${row.slug} draft: ${err instanceof Error ? err.message : "rebuild failed"}`,
          );
        }
      }
    }

    revalidatePath("/billing/run");
    revalidatePath("/invoices");
    revalidatePath("/");

    const base = `Read ${ok}/${commissionRows.length} sales figures for ${salesMonth.year}-${String(
      salesMonth.month,
    ).padStart(2, "0")}. Rebuilt ${rebuilt} draft(s).`;
    if (errors.length) return { error: `${base} ${errors.join("; ")}` };
    return { message: base };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Refresh failed" };
  }
}

export async function approvePeriodDraftsAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const operator = await requireOperator();
  const periodStart = String(formData.get("period_start") ?? "");
  const periodEnd = String(formData.get("period_end") ?? "");
  try {
    const { approveDraftsForPeriod } = await import("@/lib/invoices/approval");
    const result = await approveDraftsForPeriod(
      periodStart,
      periodEnd,
      operator.email,
    );
    revalidatePath("/billing/run");
    revalidatePath("/invoices");
    if (result.errors.length) {
      return { error: `Approved ${result.approved}. ${result.errors.join("; ")}` };
    }
    const skipNote =
      result.skipped > 0
        ? ` ${result.skipped} skipped — flagged for attention.`
        : "";
    return {
      message: `Approved ${result.approved} draft(s).${skipNote}`,
    };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Approve failed" };
  }
}

export async function approveOneAction(invoiceId: number): Promise<ActionState> {
  const operator = await requireOperator();
  try {
    const { approveDraft } = await import("@/lib/invoices/approval");
    await approveDraft(invoiceId, operator.email);
    revalidatePath("/billing/run");
    revalidatePath("/invoices");
    revalidatePath(`/invoices/${invoiceId}`);
    return { message: `Draft #${invoiceId} approved` };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Approve failed" };
  }
}

export async function unapproveOneAction(
  invoiceId: number,
): Promise<ActionState> {
  const operator = await requireOperator();
  try {
    const { unapproveDraft } = await import("@/lib/invoices/approval");
    await unapproveDraft(invoiceId, operator.email);
    revalidatePath("/billing/run");
    revalidatePath("/invoices");
    revalidatePath(`/invoices/${invoiceId}`);
    return { message: `Approval withdrawn on #${invoiceId}` };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed" };
  }
}

export async function setManualSalesAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const operator = await requireOperator();
  try {
    const { setManualSalesFigure } = await import("@/lib/invoices/approval");
    const { parseZARToCents } = await import("@/lib/money");
    const invoiceId = Number(formData.get("invoice_id"));
    const grossCents = parseZARToCents(String(formData.get("gross") ?? ""));
    await setManualSalesFigure({ invoiceId, grossCents, actor: operator.email });
    revalidatePath("/billing/run");
    revalidatePath(`/invoices/${invoiceId}`);
    return {
      message: "Sales figure recorded by hand and commission recalculated",
    };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed" };
  }
}

export async function waiveCommissionAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const operator = await requireOperator();
  try {
    const { waiveCommissionForDraft } = await import("@/lib/invoices/approval");
    const invoiceId = Number(formData.get("invoice_id"));
    const reason = String(formData.get("reason") ?? "");
    await waiveCommissionForDraft({ invoiceId, reason, actor: operator.email });
    revalidatePath("/billing/run");
    revalidatePath(`/invoices/${invoiceId}`);
    return { message: "Commission waived for this period — base fee only" };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed" };
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
    // Only approved drafts proceed. Unapproved and flagged drafts are left.
    const drafts = preview.filter(
      (r) =>
        r.existingStatus === "draft" &&
        r.existingApproved &&
        !r.existingNeedsAttention,
    );
    if (drafts.length === 0) {
      return {
        error:
          "No approved drafts for this period. Approve the drafts you have reviewed first.",
      };
    }
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

export async function createManualInvoiceAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState & { invoiceId?: number }> {
  const operator = await requireOperator();
  try {
    const { createManualDraftInvoice } = await import("@/lib/invoices/manual");
    const { parseZARToCents } = await import("@/lib/money");
    const tenantId = Number(formData.get("tenant_id"));
    const periodStart = String(formData.get("period_start") ?? "").trim();
    const periodEnd = String(formData.get("period_end") ?? "").trim();
    const seedFromSources = formData.get("seed_from_sources") === "on";

    const descriptions = formData.getAll("line_description").map(String);
    const quantities = formData.getAll("line_quantity").map(String);
    const units = formData.getAll("line_unit").map(String);
    const lines = descriptions.map((description, i) => ({
      description,
      quantity: Number(quantities[i] ?? 1),
      unitCents: parseZARToCents(units[i] ?? "0"),
    }));

    const result = await createManualDraftInvoice({
      tenantId,
      periodStart,
      periodEnd,
      actor: operator.email,
      seedFromSources,
      lines: lines.some((l) => l.description.trim()) ? lines : undefined,
    });

    revalidatePath("/invoices");
    revalidatePath(`/invoices/${result.invoiceId}`);
    revalidatePath("/billing/run");
    return {
      message: `Custom draft created`,
      invoiceId: result.invoiceId,
    };
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "Create failed",
    };
  }
}

export async function updateManualDraftAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const operator = await requireOperator();
  try {
    const { updateManualDraftLines } = await import("@/lib/invoices/manual");
    const { parseZARToCents } = await import("@/lib/money");
    const invoiceId = Number(formData.get("invoice_id"));
    const descriptions = formData.getAll("line_description").map(String);
    const quantities = formData.getAll("line_quantity").map(String);
    const units = formData.getAll("line_unit").map(String);
    const lines = descriptions.map((description, i) => ({
      description,
      quantity: Number(quantities[i] ?? 1),
      unitCents: parseZARToCents(units[i] ?? "0"),
    }));
    await updateManualDraftLines(invoiceId, lines, operator.email);
    revalidatePath(`/invoices/${invoiceId}`);
    revalidatePath("/invoices");
    return { message: "Lines saved" };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Save failed" };
  }
}

export async function addExpenseToManualDraftAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const operator = await requireOperator();
  try {
    const { addExpenseToManualDraft } = await import("@/lib/invoices/manual");
    const { parseZARToCents } = await import("@/lib/money");
    const invoiceId = Number(formData.get("invoice_id"));
    const slug = String(formData.get("slug") ?? "").trim();
    const description = String(formData.get("description") ?? "").trim();
    const kind = String(formData.get("kind") ?? "once_off") as
      | "once_off"
      | "recurring";
    const amountCents = parseZARToCents(String(formData.get("amount") ?? ""));
    await addExpenseToManualDraft({
      invoiceId,
      slug,
      description,
      kind,
      amountCents,
      actor: operator.email,
    });
    revalidatePath(`/invoices/${invoiceId}`);
    revalidatePath(`/tenants/${slug}`);
    return { message: "Expense added" };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed" };
  }
}

export async function previewSeedLinesAction(
  tenantId: number,
  periodStart: string,
  periodEnd: string,
): Promise<
  | { error: string }
  | {
      lines: {
        description: string;
        quantity: number;
        unitCents: number;
      }[];
    }
> {
  await requireOperator();
  try {
    const { previewSourceLines } = await import("@/lib/invoices/generate");
    const lines = await previewSourceLines(tenantId, periodStart, periodEnd);
    return {
      lines: lines.map((l) => ({
        description: l.description,
        quantity: l.quantity,
        unitCents: l.unitCents,
      })),
    };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Preview failed" };
  }
}

export async function defaultComingPeriod(): Promise<{
  periodStart: string;
  periodEnd: string;
}> {
  return comingBillingPeriod();
}
