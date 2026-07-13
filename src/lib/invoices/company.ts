function optional(name: string, fallback = ""): string {
  return process.env[name]?.trim() || fallback;
}

export function getMercataLegalName(): string {
  return optional("MERCATA_LEGAL_NAME", "Mercata");
}

export function getMercataAddress(): string {
  return optional(
    "MERCATA_ADDRESS",
    "South Africa",
  );
}

export function getMercataVatNumber(): string {
  return optional("VAT_NUMBER", "");
}

export function getBankingDetails(): {
  bankName: string;
  accountName: string;
  accountNumber: string;
  branchCode: string;
} {
  return {
    bankName: optional("BANK_NAME", "FNB"),
    accountName: optional("BANK_ACCOUNT_NAME", "Mercata"),
    accountNumber: optional("BANK_ACCOUNT_NUMBER", "0000000000"),
    branchCode: optional("BANK_BRANCH_CODE", "250655"),
  };
}
