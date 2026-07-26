"use server";

import { revalidatePath } from "next/cache";
import type { RowDataPacket } from "mysql2/promise";
import { requireOperator } from "@/lib/auth/server";
import { deleteBusinessFile, uploadBusinessFile } from "@/lib/files/service";
import { query } from "@/lib/db/pool";

export type FileActionState = { error?: string; message?: string };

async function revalidateFilePaths(opts: {
  tenantId?: number | null;
  tenantSlug?: string;
}) {
  revalidatePath("/files");
  if (opts.tenantSlug) {
    revalidatePath(`/tenants/${opts.tenantSlug}`);
    return;
  }
  if (opts.tenantId) {
    const rows = await query<(RowDataPacket & { slug: string })[]>(
      `SELECT slug FROM tenants WHERE id = :id LIMIT 1`,
      { id: opts.tenantId },
    );
    if (rows[0]?.slug) revalidatePath(`/tenants/${rows[0].slug}`);
  }
}

export async function uploadBusinessFileAction(
  _prev: FileActionState,
  formData: FormData,
): Promise<FileActionState> {
  const operator = await requireOperator();
  try {
    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) {
      return { error: "Choose a file to upload" };
    }

    const tenantRaw = String(formData.get("tenant_id") ?? "").trim();
    const tenantId =
      tenantRaw === "" || tenantRaw === "mercata" ? null : Number(tenantRaw);
    if (tenantRaw !== "" && tenantRaw !== "mercata" && !tenantId) {
      return { error: "Invalid tenant" };
    }

    const category = String(formData.get("category") ?? "general");
    const notes = String(formData.get("notes") ?? "").trim();
    const buf = Buffer.from(await file.arrayBuffer());

    const result = await uploadBusinessFile({
      tenantId,
      category,
      originalName: file.name,
      mimeType: file.type || "application/octet-stream",
      buffer: buf,
      notes: notes || null,
      actor: operator.email,
    });

    const tenantSlug = String(formData.get("tenant_slug") ?? "").trim();
    await revalidateFilePaths({
      tenantId,
      tenantSlug: tenantSlug || undefined,
    });

    return { message: `Uploaded ${file.name} (#${result.id})` };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Upload failed" };
  }
}

export async function deleteBusinessFileAction(
  _prev: FileActionState,
  formData: FormData,
): Promise<FileActionState> {
  const operator = await requireOperator();
  try {
    const id = Number(formData.get("file_id"));
    if (!id) return { error: "Missing file" };

    const tenantRaw = String(formData.get("tenant_id") ?? "").trim();
    const tenantId =
      tenantRaw === "" || tenantRaw === "mercata"
        ? null
        : Number(tenantRaw) || null;

    await deleteBusinessFile(id, operator.email);

    const tenantSlug = String(formData.get("tenant_slug") ?? "").trim();
    await revalidateFilePaths({
      tenantId,
      tenantSlug: tenantSlug || undefined,
    });

    return { message: "File removed" };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Delete failed" };
  }
}
