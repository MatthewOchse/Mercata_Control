import type {
  ParsedBankTransaction,
  ParsedStatement,
  StatementFormatAdapter,
} from "@/lib/payments/statement-format";

/**
 * FNB Business Banking OFX/OFC (SGML-ish) parser.
 * Dedup key: FITID (unique per statement transaction).
 */
export class OfxStatementAdapter implements StatementFormatAdapter {
  readonly format = "ofx" as const;

  parse(input: string | Buffer): ParsedStatement {
    const text = (typeof input === "string" ? input : input.toString("utf8"))
      .replace(/^\uFEFF/, "")
      .replace(/\r\n/g, "\n");

    const blocks = extractBlocks(text, "STMTTRN");
    const transactions: ParsedBankTransaction[] = [];

    for (const block of blocks) {
      const fields = parseSgmlFields(block);
      const fitid = (fields.FITID || fields.FITID_ || "").trim();
      if (!fitid) continue;

      const amountRaw = (fields.TRNAMT || "").trim();
      const amountCents = zarToSignedCents(amountRaw);
      const postedOn = ofxDateToIso(fields.DTPOSTED || "");
      if (!postedOn) continue;

      const description = [
        fields.NAME,
        fields.MEMO,
        fields.PAYEE,
      ]
        .filter(Boolean)
        .join(" — ")
        .trim();

      const reference =
        (fields.CHECKNUM || fields.REFNUM || fields.MEMO || "").trim() || null;

      const balanceCents =
        fields.BALAMT !== undefined && fields.BALAMT !== ""
          ? zarToSignedCents(fields.BALAMT)
          : null;

      transactions.push({
        fitid,
        postedOn,
        amountCents,
        description: description || "(no description)",
        reference,
        balanceCents,
        raw: fields,
      });
    }

    if (transactions.length === 0) {
      throw new Error("No STMTTRN records found in OFX file");
    }

    const dates = transactions.map((t) => t.postedOn).sort();
    const periodStart =
      ofxDateToIso(firstTag(text, "DTSTART") || "") || dates[0]!;
    const periodEnd =
      ofxDateToIso(firstTag(text, "DTEND") || "") || dates[dates.length - 1]!;

    return {
      format: "ofx",
      periodStart,
      periodEnd,
      transactions,
    };
  }
}

function zarToSignedCents(raw: string): number {
  const normalised = raw.replace(/\s/g, "").replace(",", ".");
  const n = Number(normalised);
  if (!Number.isFinite(n)) {
    throw new Error(`Invalid OFX amount: ${raw}`);
  }
  return Math.round(n * 100);
}

/** OFX dates: YYYYMMDD[HHMMSS][.XXX][:tz] */
function ofxDateToIso(raw: string): string | null {
  const m = raw.trim().match(/^(\d{4})(\d{2})(\d{2})/);
  if (!m) return null;
  return `${m[1]}-${m[2]}-${m[3]}`;
}

function firstTag(text: string, tag: string): string | null {
  const re = new RegExp(`<${tag}>([^<\\n]+)`, "i");
  const m = text.match(re);
  return m?.[1]?.trim() ?? null;
}

function extractBlocks(text: string, tag: string): string[] {
  const open = new RegExp(`<${tag}>`, "gi");
  const close = new RegExp(`</${tag}>`, "gi");
  const blocks: string[] = [];
  let match: RegExpExecArray | null;
  const opens: number[] = [];
  while ((match = open.exec(text)) !== null) {
    opens.push(match.index + match[0].length);
  }
  if (closesExist(text, tag)) {
    const closes: number[] = [];
    while ((match = close.exec(text)) !== null) {
      closes.push(match.index);
    }
    for (let i = 0; i < opens.length; i++) {
      const end = closes[i] ?? text.length;
      blocks.push(text.slice(opens[i], end));
    }
  } else {
    // Aggregate-style OFX: fields until next STMTTRN or BANKTRANLIST end
    for (let i = 0; i < opens.length; i++) {
      const start = opens[i]!;
      const nextOpen = opens[i + 1] ?? text.length;
      const endMarker = text.indexOf("</BANKTRANLIST>", start);
      const end =
        endMarker >= 0 && endMarker < nextOpen ? endMarker : nextOpen;
      blocks.push(text.slice(start, end));
    }
  }
  return blocks;
}

function closesExist(text: string, tag: string): boolean {
  return new RegExp(`</${tag}>`, "i").test(text);
}

function parseSgmlFields(block: string): Record<string, string> {
  const fields: Record<string, string> = {};
  const re = /<([A-Z0-9._]+)>([^<\n]*)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(block)) !== null) {
    const key = m[1]!.toUpperCase();
    if (key.startsWith("/")) continue;
    fields[key] = m[2]!.trim();
  }
  return fields;
}
