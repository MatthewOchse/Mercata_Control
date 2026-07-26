import type { RowDataPacket } from "mysql2/promise";
import { query } from "@/lib/db/pool";

export type BusinessFileRow = {
  id: number;
  tenantId: number | null;
  tenantSlug: string | null;
  tenantName: string | null;
  category: string;
  originalName: string;
  storagePath: string;
  mimeType: string;
  sizeBytes: number;
  uploadedBy: string;
  notes: string | null;
  createdAt: string;
};

type ListRow = RowDataPacket & {
  id: number;
  tenant_id: number | null;
  tenant_slug: string | null;
  tenant_name: string | null;
  category: string;
  original_name: string;
  storage_path: string;
  mime_type: string;
  size_bytes: number;
  uploaded_by: string;
  notes: string | null;
  created_at: string | Date;
};

function mapRow(r: ListRow): BusinessFileRow {
  return {
    id: Number(r.id),
    tenantId: r.tenant_id === null ? null : Number(r.tenant_id),
    tenantSlug: r.tenant_slug,
    tenantName: r.tenant_name,
    category: r.category,
    originalName: r.original_name,
    storagePath: r.storage_path,
    mimeType: r.mime_type,
    sizeBytes: Number(r.size_bytes),
    uploadedBy: r.uploaded_by,
    notes: r.notes,
    createdAt: String(r.created_at).slice(0, 19).replace("T", " "),
  };
}

export type ListBusinessFilesOpts = {
  /** undefined = all; null = Mercata-wide only; number = one tenant */
  tenantId?: number | null;
  category?: string;
};

export async function listBusinessFiles(
  opts: ListBusinessFilesOpts = {},
): Promise<BusinessFileRow[]> {
  const where: string[] = ["f.deleted_at IS NULL"];
  const params: Record<string, string | number> = {};

  if (opts.tenantId === null) {
    where.push("f.tenant_id IS NULL");
  } else if (opts.tenantId !== undefined) {
    where.push("f.tenant_id = :tenantId");
    params.tenantId = opts.tenantId;
  }

  if (opts.category) {
    where.push("f.category = :category");
    params.category = opts.category;
  }

  const rows = await query<ListRow[]>(
    `SELECT f.id, f.tenant_id, t.slug AS tenant_slug, t.trading_name AS tenant_name,
            f.category, f.original_name, f.storage_path, f.mime_type, f.size_bytes,
            f.uploaded_by, f.notes, f.created_at
     FROM business_files f
     LEFT JOIN tenants t ON t.id = f.tenant_id
     WHERE ${where.join(" AND ")}
     ORDER BY f.created_at DESC, f.id DESC`,
    params,
  );
  return rows.map(mapRow);
}

export async function getBusinessFileById(
  id: number,
): Promise<BusinessFileRow | null> {
  const rows = await query<ListRow[]>(
    `SELECT f.id, f.tenant_id, t.slug AS tenant_slug, t.trading_name AS tenant_name,
            f.category, f.original_name, f.storage_path, f.mime_type, f.size_bytes,
            f.uploaded_by, f.notes, f.created_at
     FROM business_files f
     LEFT JOIN tenants t ON t.id = f.tenant_id
     WHERE f.id = :id AND f.deleted_at IS NULL
     LIMIT 1`,
    { id },
  );
  const row = rows[0];
  return row ? mapRow(row) : null;
}
