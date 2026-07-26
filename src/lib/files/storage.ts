import { mkdir, writeFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { MAX_BUSINESS_FILE_BYTES } from "@/lib/files/constants";

export { BUSINESS_FILE_CATEGORIES, MAX_BUSINESS_FILE_BYTES } from "@/lib/files/constants";
export type { BusinessFileCategory } from "@/lib/files/constants";

const ALLOWED_EXT = new Set([
  ".pdf",
  ".doc",
  ".docx",
  ".xls",
  ".xlsx",
  ".csv",
  ".txt",
  ".md",
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".zip",
  ".ofx",
  ".json",
]);

export function businessFilesRoot(): string {
  return join(process.cwd(), "storage", "business-files");
}

export function sanitizeOriginalName(name: string): string {
  const base = name.replace(/[/\\]/g, "").trim();
  if (!base) throw new Error("File name is required");
  if (base.length > 255) throw new Error("File name is too long");
  return base;
}

export function assertAllowedExtension(originalName: string): string {
  const ext = extname(originalName).toLowerCase();
  if (!ALLOWED_EXT.has(ext)) {
    throw new Error(
      `File type not allowed (${ext || "no extension"}). Use PDF, Office docs, images, CSV, ZIP, etc.`,
    );
  }
  return ext;
}

export function resolveBusinessFilePath(relativePath: string): string {
  const root = resolve(businessFilesRoot());
  const absolute = resolve(process.cwd(), relativePath);
  if (absolute !== root && !absolute.startsWith(`${root}/`)) {
    throw new Error("Invalid storage path");
  }
  return absolute;
}

export function relativeStoragePath(opts: {
  tenantId: number | null;
  storedName: string;
}): string {
  const segment =
    opts.tenantId === null
      ? join("storage", "business-files", "global", opts.storedName)
      : join(
          "storage",
          "business-files",
          "tenants",
          String(opts.tenantId),
          opts.storedName,
        );
  return segment.split("\\").join("/");
}

export async function writeBusinessFile(opts: {
  tenantId: number | null;
  originalName: string;
  buffer: Buffer;
}): Promise<{ storagePath: string; storedName: string }> {
  const ext = assertAllowedExtension(opts.originalName);
  if (opts.buffer.length > MAX_BUSINESS_FILE_BYTES) {
    throw new Error("File exceeds 25 MB limit");
  }
  if (opts.buffer.length === 0) {
    throw new Error("File is empty");
  }

  const storedName = `${randomUUID()}${ext}`;
  const storagePath = relativeStoragePath({
    tenantId: opts.tenantId,
    storedName,
  });
  const absolute = resolveBusinessFilePath(storagePath);
  await mkdir(resolve(absolute, ".."), { recursive: true });
  await writeFile(absolute, opts.buffer);
  return { storagePath, storedName };
}
