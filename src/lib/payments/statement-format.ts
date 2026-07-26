/** Adapter interface for bank statement formats. OFX first; CSV later via mapping. */

export type ParsedBankTransaction = {
  fitid: string;
  postedOn: string; // YYYY-MM-DD
  amountCents: number; // signed: credit >, debit <
  description: string;
  reference: string | null;
  balanceCents: number | null;
  raw: Record<string, unknown>;
};

export type ParsedStatement = {
  format: "ofx" | "csv";
  periodStart: string;
  periodEnd: string;
  transactions: ParsedBankTransaction[];
};

export interface StatementFormatAdapter {
  readonly format: "ofx" | "csv";
  parse(input: string | Buffer): ParsedStatement;
}
