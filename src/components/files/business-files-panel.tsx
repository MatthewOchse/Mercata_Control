"use client";

import Link from "next/link";
import { useActionState } from "react";
import {
  deleteBusinessFileAction,
  uploadBusinessFileAction,
  type FileActionState,
} from "@/app/(console)/files/actions";
import {
  BUSINESS_FILE_CATEGORIES,
  categoryLabel,
  formatFileSize,
} from "@/lib/files/constants";
import type { BusinessFileRow } from "@/lib/files/queries";

const empty: FileActionState = {};

type TenantOption = { id: number; slug: string; trading_name: string };

export function BusinessFilesPanel({
  files,
  tenants,
  lockedTenantId,
  lockedTenantSlug,
}: {
  files: BusinessFileRow[];
  tenants: TenantOption[];
  lockedTenantId?: number;
  lockedTenantSlug?: string;
}) {
  const [uploadState, uploadAction, uploadPending] = useActionState(
    uploadBusinessFileAction,
    empty,
  );
  const [deleteState, deleteAction, deletePending] = useActionState(
    deleteBusinessFileAction,
    empty,
  );

  const actionState = uploadState.error
    ? uploadState
    : uploadState.message
      ? uploadState
      : deleteState;

  return (
    <div className="space-y-5">
      {actionState.error ? (
        <div className="rounded-[4px] border border-status-error bg-status-error/10 p-3 text-[13px] text-status-error">
          {actionState.error}
        </div>
      ) : null}
      {actionState.message ? (
        <div className="rounded-[4px] border border-status-ok bg-status-ok/10 p-3 text-[13px] text-status-ok">
          {actionState.message}
        </div>
      ) : null}

      <section className="rounded-[4px] border border-border bg-surface p-4">
        <h2 className="mb-3 text-[13px] font-semibold">Upload file</h2>
        <form
          action={uploadAction}
          className="flex flex-wrap items-end gap-3"
          encType="multipart/form-data"
        >
          {lockedTenantId !== undefined ? (
            <>
              <input type="hidden" name="tenant_id" value={String(lockedTenantId)} />
              {lockedTenantSlug ? (
                <input type="hidden" name="tenant_slug" value={lockedTenantSlug} />
              ) : null}
            </>
          ) : (
            <label className="flex min-w-[12rem] flex-col gap-1 text-[12px]">
              <span className="text-muted uppercase">Scope</span>
              <select
                name="tenant_id"
                defaultValue="mercata"
                className="h-8 rounded-[4px] border border-border px-2 text-[13px]"
              >
                <option value="mercata">Mercata (admin)</option>
                {tenants.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.trading_name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="flex min-w-[9rem] flex-col gap-1 text-[12px]">
            <span className="text-muted uppercase">Category</span>
            <select
              name="category"
              defaultValue="general"
              className="h-8 rounded-[4px] border border-border px-2 text-[13px]"
            >
              {BUSINESS_FILE_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {categoryLabel(c)}
                </option>
              ))}
            </select>
          </label>
          <label className="flex min-w-[14rem] flex-1 flex-col gap-1 text-[12px]">
            <span className="text-muted uppercase">Notes</span>
            <input
              name="notes"
              type="text"
              placeholder="Optional description"
              className="h-8 rounded-[4px] border border-border px-2 text-[13px]"
            />
          </label>
          <label className="flex min-w-[14rem] flex-col gap-1 text-[12px]">
            <span className="text-muted uppercase">File</span>
            <input
              name="file"
              type="file"
              required
              className="text-[12px] file:mr-2 file:rounded-[4px] file:border file:border-border file:bg-background file:px-2 file:py-1 file:text-[12px]"
            />
          </label>
          <button
            type="submit"
            disabled={uploadPending}
            className="h-8 rounded-[4px] bg-accent-strong px-3 text-[13px] font-semibold text-white hover:bg-primary disabled:opacity-50"
          >
            {uploadPending ? "Uploading…" : "Upload"}
          </button>
        </form>
        <p className="mt-2 text-[11px] text-muted">
          PDF, Office, images, CSV, ZIP — max 25 MB.
        </p>
      </section>

      <div className="overflow-x-auto">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Scope</th>
              <th>Category</th>
              <th>Size</th>
              <th>Uploaded</th>
              <th>By</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {files.length === 0 ? (
              <tr>
                <td colSpan={7} className="text-muted">
                  No files yet. Upload contracts, onboarding docs, or admin
                  references above.
                </td>
              </tr>
            ) : (
              files.map((f) => (
                <tr key={f.id}>
                  <td>
                    <div className="font-medium text-[13px]">{f.originalName}</div>
                    {f.notes ? (
                      <div className="text-[11px] text-muted">{f.notes}</div>
                    ) : null}
                  </td>
                  <td>
                    {f.tenantId === null ? (
                      <span className="text-[12px] font-medium text-primary">
                        Mercata
                      </span>
                    ) : (
                      <Link
                        href={`/tenants/${f.tenantSlug}?tab=files`}
                        className="text-[12px] text-accent-strong hover:underline"
                      >
                        {f.tenantName ?? f.tenantSlug}
                      </Link>
                    )}
                  </td>
                  <td className="text-[12px]">{categoryLabel(f.category)}</td>
                  <td className="font-mono text-[11px]">
                    {formatFileSize(f.sizeBytes)}
                  </td>
                  <td className="font-mono text-[11px] text-muted">{f.createdAt}</td>
                  <td className="font-mono text-[10px] text-muted">{f.uploadedBy}</td>
                  <td className="text-right whitespace-nowrap">
                    <a
                      href={`/files/${f.id}/download`}
                      className="text-[12px] font-semibold text-accent-strong hover:underline"
                    >
                      Download
                    </a>
                    <form action={deleteAction} className="ml-3 inline">
                      <input type="hidden" name="file_id" value={f.id} />
                      <input
                        type="hidden"
                        name="tenant_id"
                        value={f.tenantId === null ? "mercata" : String(f.tenantId)}
                      />
                      {lockedTenantSlug ? (
                        <input
                          type="hidden"
                          name="tenant_slug"
                          value={lockedTenantSlug}
                        />
                      ) : null}
                      <button
                        type="submit"
                        disabled={deletePending}
                        className="text-[12px] text-status-error hover:underline disabled:opacity-50"
                        onClick={(e) => {
                          if (
                            !confirm(`Remove ${f.originalName} from the vault?`)
                          ) {
                            e.preventDefault();
                          }
                        }}
                      >
                        Remove
                      </button>
                    </form>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function filterHref(opts: {
  scope?: string;
  tenantId?: number;
  category?: string;
}): string {
  const params = new URLSearchParams();
  if (opts.scope === "mercata") params.set("scope", "mercata");
  if (opts.scope === "tenant" && opts.tenantId) {
    params.set("scope", "tenant");
    params.set("tenant_id", String(opts.tenantId));
  }
  if (opts.category) params.set("category", opts.category);
  const q = params.toString();
  return q ? `/files?${q}` : "/files";
}

export function BusinessFilesFilters({
  scope,
  tenantId,
  category,
  tenants,
}: {
  scope?: "all" | "mercata" | "tenant";
  tenantId?: number;
  category?: string;
  tenants: TenantOption[];
}) {
  const activeScope = scope ?? "all";
  const selectedTenant = tenants.find((t) => t.id === tenantId);

  return (
    <div className="flex flex-wrap items-center gap-2 text-[12px]">
      <span className="text-muted uppercase">Show:</span>
      <Link
        href={filterHref({ category })}
        className={`rounded-[4px] border px-2 py-1 ${
          activeScope === "all"
            ? "border-primary bg-primary text-white"
            : "border-border hover:border-primary-light"
        }`}
      >
        All
      </Link>
      <Link
        href={filterHref({ scope: "mercata", category })}
        className={`rounded-[4px] border px-2 py-1 ${
          activeScope === "mercata"
            ? "border-primary bg-primary text-white"
            : "border-border hover:border-primary-light"
        }`}
      >
        Mercata
      </Link>
      {selectedTenant ? (
        <Link
          href={filterHref({ scope: "tenant", tenantId, category })}
          className="rounded-[4px] border border-primary bg-primary px-2 py-1 text-white"
        >
          {selectedTenant.trading_name}
        </Link>
      ) : null}
      <form method="get" className="inline-flex items-center gap-1">
        {category ? <input type="hidden" name="category" value={category} /> : null}
        <input type="hidden" name="scope" value="tenant" />
        <select
          name="tenant_id"
          defaultValue={tenantId ?? ""}
          className="h-7 rounded-[4px] border border-border px-2 text-[12px]"
          onChange={(e) => {
            e.currentTarget.form?.requestSubmit();
          }}
        >
          <option value="" disabled>
            Tenant…
          </option>
          {tenants.map((t) => (
            <option key={t.id} value={t.id}>
              {t.trading_name}
            </option>
          ))}
        </select>
      </form>
      <span className="ml-2 text-muted uppercase">Category:</span>
      <Link
        href={filterHref({
          scope: activeScope === "all" ? undefined : activeScope,
          tenantId,
        })}
        className={`rounded-[4px] border px-2 py-1 ${
          !category
            ? "border-primary bg-primary text-white"
            : "border-border hover:border-primary-light"
        }`}
      >
        All
      </Link>
      {BUSINESS_FILE_CATEGORIES.map((c) => (
        <Link
          key={c}
          href={filterHref({
            scope: activeScope === "all" ? undefined : activeScope,
            tenantId,
            category: c,
          })}
          className={`rounded-[4px] border px-2 py-1 ${
            category === c
              ? "border-primary bg-primary text-white"
              : "border-border hover:border-primary-light"
          }`}
        >
          {categoryLabel(c)}
        </Link>
      ))}
    </div>
  );
}
