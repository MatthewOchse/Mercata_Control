import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { writeAuditLog } from "@/lib/db/audit";
import { query, withTransaction, type PoolConnection } from "@/lib/db/pool";
import { formatInvoiceNumber } from "@/lib/invoices/invariants";
import { OfxStatementAdapter } from "@/lib/payments/ofx-adapter";
import { recordPayment } from "@/lib/payments/service";
import type {
  ParsedBankTransaction,
  StatementFormatAdapter,
} from "@/lib/payments/statement-format";

export type MatchConfidence = "high" | "medium" | "low";

export type MatchProposal = {
  invoiceId: number;
  invoiceNumber: string;
  tenantId: number;
  tradingName: string;
  legalName: string;
  outstandingCents: number;
  confidence: MatchConfidence;
  reason: string;
};

const ofxAdapter = new OfxStatementAdapter();

export function getStatementAdapter(
  format: "ofx" | "csv",
): StatementFormatAdapter {
  if (format === "ofx") return ofxAdapter;
  throw new Error(
    "CSV import requires a column-mapping step and is not enabled yet — use OFX",
  );
}

export type ImportResult = {
  importId: number;
  total: number;
  alreadySeen: number;
  newCount: number;
  periodStart: string;
  periodEnd: string;
};

export async function importStatementFile(opts: {
  filename: string;
  format: "ofx" | "csv";
  content: string | Buffer;
  actor: string;
}): Promise<ImportResult> {
  const adapter = getStatementAdapter(opts.format);
  const parsed = adapter.parse(opts.content);

  return withTransaction(async (conn) => {
    const [imp] = await conn.execute<ResultSetHeader>(
      `INSERT INTO statement_imports
         (filename, format, period_start, period_end, transaction_count,
          new_count, duplicate_count, imported_by)
       VALUES (?, ?, ?, ?, ?, 0, 0, ?)`,
      [
        opts.filename,
        opts.format,
        parsed.periodStart,
        parsed.periodEnd,
        parsed.transactions.length,
        opts.actor,
      ],
    );
    const importId = Number(imp.insertId);

    let newCount = 0;
    let alreadySeen = 0;

    for (const tx of parsed.transactions) {
      const [existing] = await conn.execute<(RowDataPacket & { id: number })[]>(
        `SELECT id FROM bank_transactions WHERE fitid = ? LIMIT 1`,
        [tx.fitid],
      );
      if (existing[0]) {
        alreadySeen++;
        continue;
      }

      const proposal =
        tx.amountCents > 0 ? await proposeMatch(conn, tx) : null;

      await conn.execute(
        `INSERT INTO bank_transactions
           (import_id, fitid, posted_on, amount_cents, description, reference,
            balance_cents, raw_json, status, proposed_invoice_id,
            proposed_confidence, proposed_reason)
         VALUES (?, ?, ?, ?, ?, ?, ?, CAST(? AS JSON), 'unmatched', ?, ?, ?)`,
        [
          importId,
          tx.fitid,
          tx.postedOn,
          tx.amountCents,
          tx.description,
          tx.reference,
          tx.balanceCents,
          JSON.stringify(tx.raw),
          proposal?.invoiceId ?? null,
          proposal?.confidence ?? null,
          proposal?.reason ?? null,
        ],
      );
      newCount++;
    }

    await conn.execute(
      `UPDATE statement_imports
       SET new_count = ?, duplicate_count = ?
       WHERE id = ?`,
      [newCount, alreadySeen, importId],
    );

    await writeAuditLog(conn, {
      actor: opts.actor,
      action: "statement.import",
      entityType: "statement_import",
      entityId: importId,
      after: {
        filename: opts.filename,
        format: opts.format,
        period_start: parsed.periodStart,
        period_end: parsed.periodEnd,
        total: parsed.transactions.length,
        new: newCount,
        already_seen: alreadySeen,
      },
    });

    return {
      importId,
      total: parsed.transactions.length,
      alreadySeen,
      newCount,
      periodStart: parsed.periodStart,
      periodEnd: parsed.periodEnd,
    };
  });
}

type OutstandingInvoice = {
  id: number;
  tenant_id: number;
  invoice_number: string;
  total_cents: number;
  paid_cents: number;
  outstanding_cents: number;
  trading_name: string;
  legal_name: string;
};

async function loadOutstandingInvoices(
  conn: PoolConnection,
): Promise<OutstandingInvoice[]> {
  const [rows] = await conn.execute<
    (RowDataPacket & {
      id: number;
      tenant_id: number;
      invoice_number: string;
      total_cents: number;
      paid_cents: number;
      trading_name: string;
      legal_name: string;
    })[]
  >(
    `SELECT i.id, i.tenant_id, i.invoice_number, i.total_cents,
            COALESCE((SELECT SUM(p.amount_cents) FROM payments p WHERE p.invoice_id = i.id), 0) AS paid_cents,
            t.trading_name, t.legal_name
     FROM invoices i
     INNER JOIN tenants t ON t.id = i.tenant_id
     WHERE i.status IN ('issued', 'overdue')
       AND i.invoice_number IS NOT NULL`,
  );
  return rows.map((r) => {
    const paid = Number(r.paid_cents);
    const total = Number(r.total_cents);
    return {
      id: Number(r.id),
      tenant_id: Number(r.tenant_id),
      invoice_number: String(r.invoice_number),
      total_cents: total,
      paid_cents: paid,
      outstanding_cents: Math.max(0, total - paid),
      trading_name: r.trading_name,
      legal_name: r.legal_name,
    };
  }).filter((r) => r.outstanding_cents > 0);
}

/** Scored matching — propose only; never creates payments. */
export async function proposeMatch(
  conn: PoolConnection,
  tx: ParsedBankTransaction,
): Promise<MatchProposal | null> {
  if (tx.amountCents <= 0) return null;
  const open = await loadOutstandingInvoices(conn);
  const haystack = `${tx.reference ?? ""} ${tx.description}`.toUpperCase();

  // High: exact invoice number in reference/description
  for (const inv of open) {
    const num = inv.invoice_number.toUpperCase();
    if (num && haystack.includes(num)) {
      return {
        invoiceId: inv.id,
        invoiceNumber: inv.invoice_number,
        tenantId: inv.tenant_id,
        tradingName: inv.trading_name,
        legalName: inv.legal_name,
        outstandingCents: inv.outstanding_cents,
        confidence: "high",
        reason: `Invoice number ${inv.invoice_number} appears in the bank reference/description`,
      };
    }
    // Also accept MER-YYYY-N without zero padding variants already normalised
    const m = haystack.match(/MER-(\d{4})-(\d{1,6})/);
    if (m) {
      const formatted = formatInvoiceNumber(Number(m[1]), Number(m[2]));
      if (formatted === inv.invoice_number) {
        return {
          invoiceId: inv.id,
          invoiceNumber: inv.invoice_number,
          tenantId: inv.tenant_id,
          tradingName: inv.trading_name,
          legalName: inv.legal_name,
          outstandingCents: inv.outstanding_cents,
          confidence: "high",
          reason: `Invoice number ${inv.invoice_number} appears in the bank reference/description`,
        };
      }
    }
  }

  const amountMatches = open.filter(
    (inv) => inv.outstanding_cents === tx.amountCents,
  );

  // Medium: amount exact + fuzzy name match
  for (const inv of amountMatches) {
    if (
      fuzzyNameMatch(haystack, inv.trading_name) ||
      fuzzyNameMatch(haystack, inv.legal_name)
    ) {
      return {
        invoiceId: inv.id,
        invoiceNumber: inv.invoice_number,
        tenantId: inv.tenant_id,
        tradingName: inv.trading_name,
        legalName: inv.legal_name,
        outstandingCents: inv.outstanding_cents,
        confidence: "medium",
        reason: `Amount equals outstanding ${inv.invoice_number} and description matches ${inv.trading_name}`,
      };
    }
  }

  // Low: amount matches an outstanding invoice with no other candidates
  if (amountMatches.length === 1) {
    const inv = amountMatches[0]!;
    return {
      invoiceId: inv.id,
      invoiceNumber: inv.invoice_number,
      tenantId: inv.tenant_id,
      tradingName: inv.trading_name,
      legalName: inv.legal_name,
      outstandingCents: inv.outstanding_cents,
      confidence: "low",
      reason: `Amount uniquely matches outstanding invoice ${inv.invoice_number} (${inv.trading_name})`,
    };
  }

  return null;
}

function fuzzyNameMatch(haystack: string, name: string): boolean {
  const tokens = name
    .toUpperCase()
    .replace(/[^A-Z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 3);
  if (tokens.length === 0) return false;
  const hits = tokens.filter((t) => haystack.includes(t)).length;
  return hits >= Math.min(2, tokens.length) || hits === tokens.length;
}

export type BankTxRow = {
  id: number;
  fitid: string;
  posted_on: string;
  amount_cents: number;
  description: string;
  reference: string | null;
  status: "unmatched" | "matched" | "ignored";
  matched_payment_id: number | null;
  proposed_invoice_id: number | null;
  proposed_confidence: MatchConfidence | null;
  proposed_reason: string | null;
  proposed_invoice_number: string | null;
  proposed_tenant: string | null;
};

export async function listUnmatchedCredits(): Promise<BankTxRow[]> {
  const rows = await query<
    (RowDataPacket & {
      id: number;
      fitid: string;
      posted_on: string;
      amount_cents: number;
      description: string;
      reference: string | null;
      status: "unmatched" | "matched" | "ignored";
      matched_payment_id: number | null;
      proposed_invoice_id: number | null;
      proposed_confidence: MatchConfidence | null;
      proposed_reason: string | null;
      proposed_invoice_number: string | null;
      proposed_tenant: string | null;
    })[]
  >(
    `SELECT bt.id, bt.fitid, bt.posted_on, bt.amount_cents, bt.description, bt.reference,
            bt.status, bt.matched_payment_id, bt.proposed_invoice_id, bt.proposed_confidence,
            bt.proposed_reason, i.invoice_number AS proposed_invoice_number,
            t.trading_name AS proposed_tenant
     FROM bank_transactions bt
     LEFT JOIN invoices i ON i.id = bt.proposed_invoice_id
     LEFT JOIN tenants t ON t.id = i.tenant_id
     WHERE bt.status = 'unmatched' AND bt.amount_cents > 0
     ORDER BY bt.posted_on DESC, bt.id DESC`,
  );
  return rows.map((r) => ({
    id: Number(r.id),
    fitid: r.fitid,
    posted_on: String(r.posted_on).slice(0, 10),
    amount_cents: Number(r.amount_cents),
    description: r.description,
    reference: r.reference,
    status: r.status,
    matched_payment_id: r.matched_payment_id
      ? Number(r.matched_payment_id)
      : null,
    proposed_invoice_id: r.proposed_invoice_id
      ? Number(r.proposed_invoice_id)
      : null,
    proposed_confidence: r.proposed_confidence,
    proposed_reason: r.proposed_reason,
    proposed_invoice_number: r.proposed_invoice_number,
    proposed_tenant: r.proposed_tenant,
  }));
}

export async function countUnmatchedCredits(): Promise<number> {
  const rows = await query<(RowDataPacket & { n: number })[]>(
    `SELECT COUNT(*) AS n FROM bank_transactions
     WHERE status = 'unmatched' AND amount_cents > 0`,
  );
  return Number(rows[0]?.n ?? 0);
}

export async function getStatementGapWarning(): Promise<{
  latestPeriodEnd: string | null;
  gapDays: number | null;
  warn: boolean;
} | null> {
  const rows = await query<(RowDataPacket & { period_end: string })[]>(
    `SELECT period_end FROM statement_imports
     ORDER BY period_end DESC LIMIT 1`,
  );
  if (!rows[0]) {
    return { latestPeriodEnd: null, gapDays: null, warn: true };
  }
  const end = String(rows[0].period_end).slice(0, 10);
  const endDate = new Date(`${end}T00:00:00Z`);
  const today = new Date();
  const todayUtc = Date.UTC(
    today.getUTCFullYear(),
    today.getUTCMonth(),
    today.getUTCDate(),
  );
  const gapDays = Math.floor(
    (todayUtc - endDate.getTime()) / (24 * 60 * 60 * 1000),
  );
  return {
    latestPeriodEnd: end,
    gapDays,
    warn: gapDays > 35,
  };
}

export async function confirmBankMatch(opts: {
  transactionId: number;
  invoiceId: number;
  actor: string;
}): Promise<{ paymentId: number }> {
  const rows = await query<
    (RowDataPacket & {
      id: number;
      amount_cents: number;
      status: string;
      posted_on: string;
      fitid: string;
      description: string;
      reference: string | null;
    })[]
  >(
    `SELECT id, amount_cents, status, posted_on, fitid, description, reference
     FROM bank_transactions WHERE id = :id LIMIT 1`,
    { id: opts.transactionId },
  );
  const tx = rows[0];
  if (!tx) throw new Error("Bank transaction not found");
  if (tx.status !== "unmatched") throw new Error("Transaction is not unmatched");
  if (Number(tx.amount_cents) <= 0) {
    throw new Error("Only credits can be matched to invoices");
  }

  const invRows = await query<
    (RowDataPacket & { id: number; tenant_id: number; status: string })[]
  >(
    `SELECT id, tenant_id, status FROM invoices WHERE id = :id LIMIT 1`,
    { id: opts.invoiceId },
  );
  const inv = invRows[0];
  if (!inv) throw new Error("Invoice not found");
  if (inv.status !== "issued" && inv.status !== "overdue") {
    throw new Error("Invoice is not open for payment");
  }

  const { paymentId } = await recordPayment({
    tenantId: Number(inv.tenant_id),
    invoiceId: Number(inv.id),
    amountCents: Number(tx.amount_cents),
    method: "eft",
    receivedOn: String(tx.posted_on).slice(0, 10),
    reference: tx.reference || tx.fitid,
    capturedBy: opts.actor,
  });

  await withTransaction(async (conn) => {
    await conn.execute(
      `UPDATE bank_transactions
       SET status = 'matched', matched_payment_id = ?,
           proposed_invoice_id = ?, ignore_reason = NULL
       WHERE id = ?`,
      [paymentId, opts.invoiceId, opts.transactionId],
    );
    await writeAuditLog(conn, {
      actor: opts.actor,
      action: "bank_transaction.match",
      entityType: "bank_transaction",
      entityId: opts.transactionId,
      after: {
        payment_id: paymentId,
        invoice_id: opts.invoiceId,
        fitid: tx.fitid,
      },
    });
  });

  return { paymentId };
}

export async function ignoreBankTransaction(opts: {
  transactionId: number;
  reason: string;
  actor: string;
}): Promise<void> {
  const reason = opts.reason.trim();
  if (!reason) throw new Error("Ignore reason is required");
  await withTransaction(async (conn) => {
    const [rows] = await conn.execute<(RowDataPacket & { status: string })[]>(
      `SELECT status FROM bank_transactions WHERE id = ? LIMIT 1`,
      [opts.transactionId],
    );
    if (!rows[0]) throw new Error("Transaction not found");
    if (rows[0].status !== "unmatched") {
      throw new Error("Only unmatched transactions can be ignored");
    }
    await conn.execute(
      `UPDATE bank_transactions
       SET status = 'ignored', ignore_reason = ?,
           proposed_invoice_id = NULL, proposed_confidence = NULL, proposed_reason = NULL
       WHERE id = ?`,
      [reason, opts.transactionId],
    );
    await writeAuditLog(conn, {
      actor: opts.actor,
      action: "bank_transaction.ignore",
      entityType: "bank_transaction",
      entityId: opts.transactionId,
      after: { reason },
    });
  });
}

export async function markBankUnallocated(opts: {
  transactionId: number;
  actor: string;
}): Promise<{ paymentId: number }> {
  const rows = await query<
    (RowDataPacket & {
      id: number;
      amount_cents: number;
      status: string;
      posted_on: string;
      fitid: string;
      reference: string | null;
      proposed_invoice_id: number | null;
    })[]
  >(
    `SELECT id, amount_cents, status, posted_on, fitid, reference, proposed_invoice_id
     FROM bank_transactions WHERE id = :id LIMIT 1`,
    { id: opts.transactionId },
  );
  const tx = rows[0];
  if (!tx) throw new Error("Bank transaction not found");
  if (tx.status !== "unmatched") throw new Error("Not unmatched");
  if (Number(tx.amount_cents) <= 0) throw new Error("Only credits");

  // Need a tenant — use proposed invoice's tenant if present, else require match UI to pick invoice.
  if (!tx.proposed_invoice_id) {
    throw new Error(
      "Pick an invoice first (Match to invoice) — unallocated payments still need a tenant",
    );
  }
  const invRows = await query<(RowDataPacket & { tenant_id: number })[]>(
    `SELECT tenant_id FROM invoices WHERE id = :id LIMIT 1`,
    { id: tx.proposed_invoice_id },
  );
  const tenantId = Number(invRows[0]?.tenant_id);
  if (!tenantId) throw new Error("Cannot resolve tenant for unallocated payment");

  const { paymentId } = await recordPayment({
    tenantId,
    invoiceId: null,
    amountCents: Number(tx.amount_cents),
    method: "eft",
    receivedOn: String(tx.posted_on).slice(0, 10),
    reference: tx.reference || tx.fitid,
    capturedBy: opts.actor,
  });

  await withTransaction(async (conn) => {
    await conn.execute(
      `UPDATE bank_transactions
       SET status = 'matched', matched_payment_id = ?
       WHERE id = ?`,
      [paymentId, opts.transactionId],
    );
    await writeAuditLog(conn, {
      actor: opts.actor,
      action: "bank_transaction.unallocated",
      entityType: "bank_transaction",
      entityId: opts.transactionId,
      after: { payment_id: paymentId, tenant_id: tenantId },
    });
  });

  return { paymentId };
}

export async function setProposedInvoice(opts: {
  transactionId: number;
  invoiceId: number;
  actor: string;
}): Promise<void> {
  await withTransaction(async (conn) => {
    const [inv] = await conn.execute<
      (RowDataPacket & {
        id: number;
        invoice_number: string;
        trading_name: string;
      })[]
    >(
      `SELECT i.id, i.invoice_number, t.trading_name
       FROM invoices i INNER JOIN tenants t ON t.id = i.tenant_id
       WHERE i.id = ? LIMIT 1`,
      [opts.invoiceId],
    );
    if (!inv[0]) throw new Error("Invoice not found");
    await conn.execute(
      `UPDATE bank_transactions
       SET proposed_invoice_id = ?, proposed_confidence = 'high',
           proposed_reason = ?
       WHERE id = ? AND status = 'unmatched'`,
      [
        opts.invoiceId,
        `Manually selected invoice ${inv[0].invoice_number} (${inv[0].trading_name})`,
        opts.transactionId,
      ],
    );
    await writeAuditLog(conn, {
      actor: opts.actor,
      action: "bank_transaction.propose",
      entityType: "bank_transaction",
      entityId: opts.transactionId,
      after: { invoice_id: opts.invoiceId },
    });
  });
}

export async function listOpenInvoicesForReconcile(): Promise<
  {
    id: number;
    invoice_number: string;
    trading_name: string;
    outstanding_cents: number;
  }[]
> {
  const rows = await query<
    (RowDataPacket & {
      id: number;
      invoice_number: string;
      trading_name: string;
      total_cents: number;
      paid_cents: number;
    })[]
  >(
    `SELECT i.id, i.invoice_number, t.trading_name, i.total_cents,
            COALESCE((SELECT SUM(p.amount_cents) FROM payments p WHERE p.invoice_id = i.id), 0) AS paid_cents
     FROM invoices i
     INNER JOIN tenants t ON t.id = i.tenant_id
     WHERE i.status IN ('issued', 'overdue') AND i.invoice_number IS NOT NULL
     ORDER BY i.issue_date DESC`,
  );
  return rows
    .map((r) => ({
      id: Number(r.id),
      invoice_number: String(r.invoice_number),
      trading_name: r.trading_name,
      outstanding_cents: Math.max(
        0,
        Number(r.total_cents) - Number(r.paid_cents),
      ),
    }))
    .filter((r) => r.outstanding_cents > 0);
}
