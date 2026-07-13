import { describe, expect, it } from "vitest";
import {
  invoicePdfRelativePath,
  pdfAlreadyExists,
} from "./pdf";

describe("invoice PDF legal record", () => {
  it("stores under storage/invoices/{year}/{number}.pdf", () => {
    expect(invoicePdfRelativePath(2026, "MER-2026-0001")).toBe(
      "storage/invoices/2026/MER-2026-0001.pdf",
    );
  });

  it("reports missing file as not existing", async () => {
    const exists = await pdfAlreadyExists(2099, "MER-2099-9999");
    expect(exists).toBe(false);
  });
});
