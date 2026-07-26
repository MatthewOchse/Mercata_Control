"use client";

import { useActionState, useState } from "react";
import {
  addExpenseToManualDraftAction,
  updateManualDraftAction,
  type ActionState,
} from "@/app/(console)/billing/actions";
import type { InvoiceDetail } from "@/lib/invoices/queries";

const empty: ActionState = {};

function centsToInput(cents: number): string {
  const rand = Math.trunc(cents / 100);
  const frac = Math.abs(cents % 100);
  if (frac === 0) return String(rand);
  return `${rand}.${String(frac).padStart(2, "0")}`;
}

type LineRow = { description: string; quantity: number; unit: string };

export function ManualDraftEditor({ invoice }: { invoice: InvoiceDetail }) {
  const [lines, setLines] = useState<LineRow[]>(
    invoice.lines.map((l) => ({
      description: l.description,
      quantity: l.quantity,
      unit: centsToInput(l.unit_cents),
    })),
  );
  const [saveState, saveAction, savePending] = useActionState(
    updateManualDraftAction,
    empty,
  );
  const [expState, expAction, expPending] = useActionState(
    addExpenseToManualDraftAction,
    empty,
  );

  return (
    <div className="space-y-4 rounded-[4px] border border-border bg-surface p-4">
      <h3 className="text-[12px] font-semibold tracking-wide text-muted uppercase">
        Edit custom draft lines
      </h3>
      <form action={saveAction} className="space-y-3">
        <input type="hidden" name="invoice_id" value={invoice.id} />
        <table className="admin-table">
          <thead>
            <tr>
              <th>Description</th>
              <th className="w-20">Qty</th>
              <th className="w-28">Unit (ZAR)</th>
              <th className="w-16" />
            </tr>
          </thead>
          <tbody>
            {lines.map((line, idx) => (
              <tr key={idx}>
                <td>
                  <input
                    name="line_description"
                    value={line.description}
                    onChange={(e) => {
                      const v = e.target.value;
                      setLines((prev) =>
                        prev.map((row, i) =>
                          i === idx ? { ...row, description: v } : row,
                        ),
                      );
                    }}
                    className="h-8 w-full rounded-[4px] border border-border px-2 text-[13px]"
                  />
                </td>
                <td>
                  <input
                    name="line_quantity"
                    type="number"
                    min={1}
                    value={line.quantity}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      setLines((prev) =>
                        prev.map((row, i) =>
                          i === idx ? { ...row, quantity: v } : row,
                        ),
                      );
                    }}
                    className="h-8 w-full rounded-[4px] border border-border px-2 font-mono text-[13px]"
                  />
                </td>
                <td>
                  <input
                    name="line_unit"
                    value={line.unit}
                    onChange={(e) => {
                      const v = e.target.value;
                      setLines((prev) =>
                        prev.map((row, i) =>
                          i === idx ? { ...row, unit: v } : row,
                        ),
                      );
                    }}
                    className="h-8 w-full rounded-[4px] border border-border px-2 font-mono text-[13px]"
                  />
                </td>
                <td>
                  <button
                    type="button"
                    onClick={() =>
                      setLines((prev) => prev.filter((_, i) => i !== idx))
                    }
                    className="text-[12px] text-status-error hover:underline"
                  >
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() =>
              setLines((prev) => [
                ...prev,
                { description: "", quantity: 1, unit: "" },
              ])
            }
            className="h-8 rounded-[4px] border border-border px-3 text-[12px] font-semibold hover:border-primary-light hover:bg-primary hover:text-white"
          >
            Add line
          </button>
          <button
            type="submit"
            disabled={savePending}
            className="h-8 rounded-[4px] bg-accent-strong px-3 text-[12px] font-semibold text-white hover:bg-primary disabled:opacity-60"
          >
            Save lines
          </button>
        </div>
        {saveState.error ? (
          <p className="text-[12px] text-status-error">{saveState.error}</p>
        ) : null}
        {saveState.message ? (
          <p className="text-[12px] text-status-ok">{saveState.message}</p>
        ) : null}
      </form>

      <form
        action={expAction}
        className="flex flex-wrap items-end gap-2 border-t border-border pt-4"
      >
        <input type="hidden" name="invoice_id" value={invoice.id} />
        <input type="hidden" name="slug" value={invoice.slug} />
        <label className="flex flex-col gap-1">
          <span className="text-[11px] text-muted uppercase">
            Add expense (saved on tenant)
          </span>
          <input
            name="description"
            required
            placeholder="Description"
            className="h-8 w-48 rounded-[4px] border border-border px-2 text-[13px]"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] text-muted uppercase">Amount</span>
          <input
            name="amount"
            required
            placeholder="250"
            className="h-8 w-28 rounded-[4px] border border-border px-2 font-mono text-[13px]"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] text-muted uppercase">Kind</span>
          <select
            name="kind"
            defaultValue="once_off"
            className="h-8 rounded-[4px] border border-border px-2 text-[13px]"
          >
            <option value="once_off">Once-off</option>
            <option value="recurring">Recurring</option>
          </select>
        </label>
        <button
          type="submit"
          disabled={expPending}
          className="h-8 rounded-[4px] border border-border px-3 text-[12px] font-semibold hover:border-primary-light hover:bg-primary hover:text-white disabled:opacity-60"
        >
          Add expense
        </button>
        {expState.error ? (
          <span className="text-[12px] text-status-error">{expState.error}</span>
        ) : null}
        {expState.message ? (
          <span className="text-[12px] text-status-ok">{expState.message}</span>
        ) : null}
      </form>
    </div>
  );
}
