/**
 * All money in this codebase is integer cents (ZAR).
 * Never use floating-point arithmetic for currency.
 */

const ZAR_FORMATTER = new Intl.NumberFormat("en-ZA", {
  style: "currency",
  currency: "ZAR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Format integer cents as ZAR, e.g. 150000 → "R 1 500,00". */
export function formatZAR(cents: number): string {
  if (!Number.isInteger(cents)) {
    throw new Error(`formatZAR expects integer cents, got ${cents}`);
  }
  return ZAR_FORMATTER.format(cents / 100);
}

/** Format cents without currency symbol, e.g. 150000 → "1 500,00". */
export function formatCentsPlain(cents: number): string {
  if (!Number.isInteger(cents)) {
    throw new Error(`formatCentsPlain expects integer cents, got ${cents}`);
  }
  return new Intl.NumberFormat("en-ZA", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

/**
 * Parse a user-entered Rand amount into integer cents.
 * Accepts "1500", "1 500,00", "R1,500.00", "1500.50".
 */
export function parseZARToCents(input: string): number {
  const trimmed = input.trim().replace(/^R\s*/i, "").replace(/\s/g, "");
  if (!trimmed) {
    throw new Error("Amount is required");
  }

  let normalised: string;
  if (trimmed.includes(",") && trimmed.includes(".")) {
    // Ambiguous locale: treat last separator as decimal.
    const lastComma = trimmed.lastIndexOf(",");
    const lastDot = trimmed.lastIndexOf(".");
    if (lastComma > lastDot) {
      normalised = trimmed.replace(/\./g, "").replace(",", ".");
    } else {
      normalised = trimmed.replace(/,/g, "");
    }
  } else if (trimmed.includes(",")) {
    const parts = trimmed.split(",");
    if (parts.length === 2 && (parts[1]?.length ?? 0) <= 2) {
      normalised = `${parts[0]}.${parts[1]}`;
    } else {
      normalised = trimmed.replace(/,/g, "");
    }
  } else {
    normalised = trimmed;
  }

  if (!/^-?\d+(\.\d{1,2})?$/.test(normalised)) {
    throw new Error(`Invalid amount: ${input}`);
  }

  const negative = normalised.startsWith("-");
  const abs = negative ? normalised.slice(1) : normalised;
  const [randPart, fracPart = ""] = abs.split(".");
  const cents =
    Number.parseInt(randPart ?? "0", 10) * 100 +
    Number.parseInt((fracPart + "00").slice(0, 2), 10);

  return negative ? -cents : cents;
}

/** Multiply quantity × unit_cents with integer arithmetic only. */
export function lineTotalCents(quantity: number, unitCents: number): number {
  if (!Number.isInteger(quantity) || quantity < 0) {
    throw new Error(`quantity must be a non-negative integer, got ${quantity}`);
  }
  if (!Number.isInteger(unitCents)) {
    throw new Error(`unitCents must be an integer, got ${unitCents}`);
  }
  return quantity * unitCents;
}

/** Sum an array of integer cent amounts. */
export function sumCents(amounts: readonly number[]): number {
  let total = 0;
  for (const amount of amounts) {
    if (!Number.isInteger(amount)) {
      throw new Error(`sumCents expects integer cents, got ${amount}`);
    }
    total += amount;
  }
  return total;
}

/** 15% VAT on a net (ex-VAT) amount in cents, rounded half-up. */
export function vatOnNetCents(netCents: number): number {
  if (!Number.isInteger(netCents)) {
    throw new Error(`vatOnNetCents expects integer cents, got ${netCents}`);
  }
  // half-up: (net * 15 + 50) / 100
  return Math.trunc((netCents * 15 + 50) / 100);
}
