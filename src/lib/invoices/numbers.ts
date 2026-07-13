import type { PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import {
  formatCreditNoteNumber,
  formatInvoiceNumber,
} from "@/lib/invoices/invariants";

type SequenceKey = "invoice" | "credit_note";

/**
 * Allocate the next gap-free number under a row lock.
 * Must be called inside an open transaction.
 */
export async function allocateSequenceNumber(
  conn: PoolConnection,
  key: SequenceKey,
  year: number,
): Promise<{ seq: number; formatted: string }> {
  await conn.execute(
    "INSERT INTO number_sequences (`key`, year, `last_value`) VALUES (?, ?, 0) ON DUPLICATE KEY UPDATE `last_value` = `last_value`",
    [key, year],
  );

  const [rows] = await conn.execute<(RowDataPacket & { last_value: number })[]>(
    "SELECT `last_value` FROM number_sequences WHERE `key` = ? AND year = ? FOR UPDATE",
    [key, year],
  );
  const current = Number(rows[0]?.last_value ?? 0);
  const seq = current + 1;

  await conn.execute<ResultSetHeader>(
    "UPDATE number_sequences SET `last_value` = ? WHERE `key` = ? AND year = ?",
    [seq, key, year],
  );

  const formatted =
    key === "invoice"
      ? formatInvoiceNumber(year, seq)
      : formatCreditNoteNumber(year, seq);

  return { seq, formatted };
}
