export type InvoiceStatus =
  | "draft"
  | "issued"
  | "paid"
  | "overdue"
  | "void";

/** Statuses whose financial content must never be edited or deleted. */
export const IMMUTABLE_STATUSES: ReadonlySet<InvoiceStatus> = new Set([
  "issued",
  "paid",
  "overdue",
  "void",
]);

/**
 * Only permitted status transitions.
 * issued → paid | overdue | void
 * overdue → paid | void
 * draft → issued | (delete allowed only for draft)
 * paid / void are terminal.
 */
const ALLOWED: Record<InvoiceStatus, ReadonlySet<InvoiceStatus>> = {
  draft: new Set(["issued"]),
  issued: new Set(["paid", "overdue", "void"]),
  overdue: new Set(["paid", "void"]),
  paid: new Set(),
  void: new Set(),
};

export function canTransition(
  from: InvoiceStatus,
  to: InvoiceStatus,
): boolean {
  if (from === to) return false;
  return ALLOWED[from]?.has(to) ?? false;
}

export function assertCanTransition(
  from: InvoiceStatus,
  to: InvoiceStatus,
): void {
  if (!canTransition(from, to)) {
    throw new Error(
      `Illegal invoice transition: ${from} → ${to}. Issued/paid/void invoices are immutable except issued→paid|overdue|void (and overdue→paid|void).`,
    );
  }
}

export function assertDraftMutable(status: InvoiceStatus): void {
  if (status !== "draft") {
    throw new Error(
      `Invoice is ${status} and immutable. There is no edit or delete path — use a credit note to correct.`,
    );
  }
}

export function isImmutable(status: InvoiceStatus): boolean {
  return IMMUTABLE_STATUSES.has(status);
}

export function formatInvoiceNumber(year: number, seq: number): string {
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    throw new Error(`Invalid invoice year: ${year}`);
  }
  if (!Number.isInteger(seq) || seq < 1) {
    throw new Error(`Invalid invoice sequence: ${seq}`);
  }
  return `MER-${year}-${String(seq).padStart(4, "0")}`;
}

export function formatCreditNoteNumber(year: number, seq: number): string {
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    throw new Error(`Invalid credit note year: ${year}`);
  }
  if (!Number.isInteger(seq) || seq < 1) {
    throw new Error(`Invalid credit note sequence: ${seq}`);
  }
  return `CN-${year}-${String(seq).padStart(4, "0")}`;
}

export function invoiceDocumentTitle(vatRegistered: boolean): "Invoice" | "Tax Invoice" {
  return vatRegistered ? "Tax Invoice" : "Invoice";
}

export function computeInvoiceTotals(
  lineTotals: readonly number[],
  vatRegistered: boolean,
): { subtotalCents: number; vatCents: number; totalCents: number } {
  let subtotal = 0;
  for (const line of lineTotals) {
    if (!Number.isInteger(line)) {
      throw new Error(`Line total must be integer cents, got ${line}`);
    }
    subtotal += line;
  }
  const vatCents = vatRegistered
    ? Math.trunc((subtotal * 15 + 50) / 100)
    : 0;
  return {
    subtotalCents: subtotal,
    vatCents,
    totalCents: subtotal + vatCents,
  };
}

/** Add calendar days to a YYYY-MM-DD date (UTC date arithmetic). */
export function addDaysIso(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d!));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}
