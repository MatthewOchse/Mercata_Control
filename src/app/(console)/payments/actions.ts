"use server";

import { revalidatePath } from "next/cache";
import { requireOperator } from "@/lib/auth/server";
import { parseZARToCents } from "@/lib/money";
import {
  allocatePayment,
  recordPayment,
  type PaymentMethod,
} from "@/lib/payments/service";

export type PaymentActionState = { error?: string; message?: string };

export async function recordPaymentAction(
  _prev: PaymentActionState,
  formData: FormData,
): Promise<PaymentActionState> {
  const operator = await requireOperator();
  try {
    const tenantId = Number(formData.get("tenant_id"));
    const invoiceRaw = String(formData.get("invoice_id") ?? "").trim();
    const invoiceId =
      invoiceRaw === "" || invoiceRaw === "unallocated"
        ? null
        : Number(invoiceRaw);
    const amountCents = parseZARToCents(String(formData.get("amount") ?? ""));
    const method = String(formData.get("method") ?? "eft") as PaymentMethod;
    const receivedOn = String(formData.get("received_on") ?? "").trim();
    const reference = String(formData.get("reference") ?? "").trim();

    if (!tenantId || !receivedOn) {
      return { error: "Tenant and received date are required" };
    }

    const result = await recordPayment({
      tenantId,
      invoiceId: Number.isFinite(invoiceId as number) ? invoiceId : null,
      amountCents,
      method,
      receivedOn,
      reference: reference || undefined,
      capturedBy: operator.email,
    });

    revalidatePath("/payments");
    revalidatePath("/");
    if (invoiceId) {
      revalidatePath(`/invoices/${invoiceId}`);
      revalidatePath("/invoices");
    }

    if (result.invoicePaid) {
      return { message: "Payment recorded — invoice marked paid" };
    }
    if (invoiceId === null) {
      return { message: "Unallocated payment recorded" };
    }
    return {
      message: `Payment recorded. Outstanding ${result.outstandingCents ?? 0} cents.`,
    };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Payment failed" };
  }
}

export async function allocatePaymentAction(
  _prev: PaymentActionState,
  formData: FormData,
): Promise<PaymentActionState> {
  const operator = await requireOperator();
  try {
    const paymentId = Number(formData.get("payment_id"));
    const invoiceId = Number(formData.get("invoice_id"));
    const result = await allocatePayment(
      paymentId,
      invoiceId,
      operator.email,
    );
    revalidatePath("/payments");
    revalidatePath(`/invoices/${invoiceId}`);
    revalidatePath("/");
    return {
      message: result.invoicePaid
        ? "Allocated — invoice paid"
        : `Allocated. Outstanding ${result.outstandingCents} cents.`,
    };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Allocate failed" };
  }
}
