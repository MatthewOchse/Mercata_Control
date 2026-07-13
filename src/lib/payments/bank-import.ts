/**
 * Bank statement CSV import — stubbed for a later enhancement.
 * Fuzzy matching on payment reference against open invoices.
 *
 * Do not implement the matcher yet; this interface is the contract.
 */

export type BankStatementRow = {
  date: string;
  amountCents: number;
  reference: string;
  description: string;
};

export type BankMatchSuggestion = {
  statementRow: BankStatementRow;
  /** Best-effort invoice candidates by reference similarity. */
  candidates: {
    invoiceId: number;
    invoiceNumber: string;
    score: number;
  }[];
};

export interface BankStatementImporter {
  /** Parse a CSV buffer into normalised rows (ZAR → integer cents). */
  parseCsv(csv: Buffer | string): Promise<BankStatementRow[]>;

  /**
   * Suggest invoice matches for each row using fuzzy reference matching.
   * Not implemented yet — throws.
   */
  suggestMatches(
    rows: BankStatementRow[],
    tenantId?: number,
  ): Promise<BankMatchSuggestion[]>;
}

export class UnimplementedBankStatementImporter
  implements BankStatementImporter
{
  async parseCsv(): Promise<BankStatementRow[]> {
    throw new Error(
      "Bank statement CSV import is not implemented yet — stub only.",
    );
  }

  async suggestMatches(): Promise<BankMatchSuggestion[]> {
    throw new Error(
      "Bank statement fuzzy matching is not implemented yet — stub only.",
    );
  }
}

export const bankStatementImporter: BankStatementImporter =
  new UnimplementedBankStatementImporter();
