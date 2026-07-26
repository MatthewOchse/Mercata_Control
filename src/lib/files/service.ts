import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { writeAuditLog } from "@/lib/db/audit";
import { withTransaction } from "@/lib/db/pool";
import {
  BUSINESS_FILE_CATEGORIES,
  type BusinessFileCategory,
} from "@/lib/files/constants";
import { sanitizeOriginalName, writeBusinessFile } from "@/lib/files/storage";

function parseCategory(raw: string): BusinessFileCategory {
  const c = raw.trim().toLowerCase();
  if ((BUSINESS_FILE_CATEGORIES as readonly string[]).includes(c)) {
    return c as BusinessFileCategory;
  }
  return "general";
}

export async function uploadBusinessFile(opts: {
  tenantId: number | null;
  category: string;
  originalName: string;
  mimeType: string;
  buffer: Buffer;
  notes: string | null;
  actor: string;
}): Promise<{ id: number }> {
  const originalName = sanitizeOriginalName(opts.originalName);
  const category = parseCategory(opts.category);
  const { storagePath } = await writeBusinessFile({
    tenantId: opts.tenantId,
    originalName,
    buffer: opts.buffer,
  });

  return withTransaction(async (conn) => {
    const [result] = await conn.execute<ResultSetHeader>(
      `INSERT INTO business_files
         (tenant_id, category, original_name, storage_path, mime_type, size_bytes, uploaded_by, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        opts.tenantId,
        category,
        originalName,
        storagePath,
        opts.mimeType || "application/octet-stream",
        opts.buffer.length,
        opts.actor,
        opts.notes?.trim() || null,
      ],
    );
    const id = Number(result.insertId);
    await writeAuditLog(conn, {
      actor: opts.actor,
      action: "business_file.uploaded",
      entityType: "business_file",
      entityId: id,
      after: {
        tenant_id: opts.tenantId,
        category,
        original_name: originalName,
        size_bytes: opts.buffer.length,
      },
    });
    return { id };
  });
}

export async function deleteBusinessFile(
  id: number,
  actor: string,
): Promise<void> {
  await withTransaction(async (conn) => {
    type FileRow = RowDataPacket & {
      original_name: string;
      tenant_id: number | null;
    };
    const [rows] = await conn.execute<FileRow[]>(
      `SELECT original_name, tenant_id FROM business_files
       WHERE id = ? AND deleted_at IS NULL LIMIT 1`,
      [id],
    );
    const row = rows[0];
    if (!row) throw new Error("File not found");

    await conn.execute(
      `UPDATE business_files SET deleted_at = UTC_TIMESTAMP(3) WHERE id = ?`,
      [id],
    );
    await writeAuditLog(conn, {
      actor,
      action: "business_file.deleted",
      entityType: "business_file",
      entityId: id,
      before: {
        original_name: row.original_name,
        tenant_id: row.tenant_id,
      },
    });
  });
}
