import { describe, expect, it } from "vitest";
import {
  addDaysIso,
  assertCanTransition,
  assertDraftMutable,
  canTransition,
  computeInvoiceTotals,
  formatCreditNoteNumber,
  formatInvoiceNumber,
  IMMUTABLE_STATUSES,
  invoiceDocumentTitle,
  isImmutable,
} from "./invariants";

describe("invoice immutability", () => {
  it("marks issued, paid, overdue, and void as immutable", () => {
    expect(isImmutable("issued")).toBe(true);
    expect(isImmutable("paid")).toBe(true);
    expect(isImmutable("overdue")).toBe(true);
    expect(isImmutable("void")).toBe(true);
    expect(isImmutable("draft")).toBe(false);
    expect(IMMUTABLE_STATUSES.has("issued")).toBe(true);
  });

  it("allows only issued → paid | overdue | void", () => {
    expect(canTransition("issued", "paid")).toBe(true);
    expect(canTransition("issued", "overdue")).toBe(true);
    expect(canTransition("issued", "void")).toBe(true);
    expect(canTransition("issued", "draft")).toBe(false);
    expect(canTransition("issued", "issued")).toBe(false);
  });

  it("allows overdue → paid | void only", () => {
    expect(canTransition("overdue", "paid")).toBe(true);
    expect(canTransition("overdue", "void")).toBe(true);
    expect(canTransition("overdue", "issued")).toBe(false);
  });

  it("forbids any transition from paid or void", () => {
    for (const to of ["draft", "issued", "paid", "overdue", "void"] as const) {
      expect(canTransition("paid", to)).toBe(false);
      expect(canTransition("void", to)).toBe(false);
    }
  });

  it("only draft may become issued", () => {
    expect(canTransition("draft", "issued")).toBe(true);
    expect(canTransition("draft", "paid")).toBe(false);
  });

  it("assertCanTransition throws on illegal paths", () => {
    expect(() => assertCanTransition("paid", "void")).toThrow(/Illegal/);
    expect(() => assertCanTransition("issued", "draft")).toThrow(/Illegal/);
    expect(() => assertCanTransition("issued", "paid")).not.toThrow();
  });

  it("assertDraftMutable refuses issued/paid/void (no edit/delete path)", () => {
    expect(() => assertDraftMutable("draft")).not.toThrow();
    expect(() => assertDraftMutable("issued")).toThrow(/credit note/);
    expect(() => assertDraftMutable("paid")).toThrow(/immutable/);
    expect(() => assertDraftMutable("void")).toThrow(/immutable/);
  });
});

describe("invoice numbers", () => {
  it("formats gap-free sequential MER-YYYY-NNNN", () => {
    expect(formatInvoiceNumber(2026, 1)).toBe("MER-2026-0001");
    expect(formatInvoiceNumber(2026, 12)).toBe("MER-2026-0012");
    expect(formatInvoiceNumber(2026, 9999)).toBe("MER-2026-9999");
  });

  it("formats credit notes as CN-YYYY-NNNN", () => {
    expect(formatCreditNoteNumber(2026, 1)).toBe("CN-2026-0001");
  });

  it("rejects non-positive sequences", () => {
    expect(() => formatInvoiceNumber(2026, 0)).toThrow();
    expect(() => formatCreditNoteNumber(2026, -1)).toThrow();
  });
});

describe("VAT document rules", () => {
  it('titles "Invoice" when not VAT registered — never Tax Invoice', () => {
    expect(invoiceDocumentTitle(false)).toBe("Invoice");
    expect(invoiceDocumentTitle(false)).not.toBe("Tax Invoice");
  });

  it('titles "Tax Invoice" when VAT registered', () => {
    expect(invoiceDocumentTitle(true)).toBe("Tax Invoice");
  });

  it("computes no VAT line when not registered", () => {
    const t = computeInvoiceTotals([220000, 300000], false);
    expect(t.subtotalCents).toBe(520000);
    expect(t.vatCents).toBe(0);
    expect(t.totalCents).toBe(520000);
  });

  it("adds 15% VAT half-up on subtotal when registered", () => {
    const t = computeInvoiceTotals([10000], true);
    expect(t.vatCents).toBe(1500);
    expect(t.totalCents).toBe(11500);
  });

  it("uses integer cents only", () => {
    expect(() => computeInvoiceTotals([10.5], false)).toThrow(/integer/);
  });
});

describe("due date", () => {
  it("is issue date + 7 days", () => {
    expect(addDaysIso("2026-08-01", 7)).toBe("2026-08-08");
    expect(addDaysIso("2026-08-28", 7)).toBe("2026-09-04");
  });
});
