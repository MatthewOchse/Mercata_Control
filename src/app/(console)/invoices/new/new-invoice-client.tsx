"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState, useTransition } from "react";
import {
  createManualInvoiceAction,
  previewSeedLinesAction,
  type ActionState,
} from "@/app/(console)/billing/actions";
import { formatCentsPlain } from "@/lib/money";

type TenantOpt = { id: number; slug: string; tradingName: string };
type LineRow = { description: string; quantity: number; unit: string };

const empty: ActionState & { invoiceId?: number } = {};

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function monthToPeriod(ym: string): { start: string; end: string } {
  const [y, m] = ym.split("-").map(Number);
  const start = `${y}-${pad2(m!)}-01`;
  const last = new Date(Date.UTC(y!, m!, 0)).getUTCDate();
  return { start, end: `${y}-${pad2(m!)}-${pad2(last)}` };
}

function centsToInput(cents: number): string {
  const rand = Math.trunc(cents / 100);
  const frac = Math.abs(cents % 100);
  if (frac === 0) return String(rand);
  return `${rand}.${String(frac).padStart(2, "0")}`;
}

export function NewInvoiceClient({
  tenants,
  defaultTenantId,
  defaultMonth,
}: {
  tenants: TenantOpt[];
  defaultTenantId: number | null;
  defaultMonth: string;
}) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(
    createManualInvoiceAction,
    empty,
  );
  const [seedPending, startSeed] = useTransition();
  const [tenantId, setTenantId] = useState(defaultTenantId ?? 0);
  const [month, setMonth] = useState(defaultMonth);
  const [seed, setSeed] = useState(true);
  const [lines, setLines] = useState<LineRow[]>([
    { description: "", quantity: 1, unit: "" },
  ]);
  const [seedError, setSeedError] = useState<string | null>(null);

  const period = monthToPeriod(month);

  useEffect(() => {
    if (state.invoiceId) {
      router.push(`/invoices/${state.invoiceId}`);
    }
  }, [state.invoiceId, router]);

  function loadSeed() {
    if (!tenantId) return;
    setSeedError(null);
    startSeed(async () => {
      const r = await previewSeedLinesAction(
        tenantId,
        period.start,
        period.end,
      );
      if ("error" in r) {
        setSeedError(r.error);
        return;
      }
      setLines(
        r.lines.map((l) => ({
          description: l.description,
          quantity: l.quantity,
          unit: centsToInput(l.unitCents),
        })),
      );
      setSeed(true);
    });
  }

  return (
    <form action={formAction} className="max-w-3xl space-y-4">
      <input type="hidden" name="period_start" value={period.start} />
      <input type="hidden" name="period_end" value={period.end} />
      {seed ? <input type="hidden" name="seed_from_sources" value="on" /> : null}

      <div className="flex flex-wrap gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-[11px] text-muted uppercase">Tenant</span>
          <select
            name="tenant_id"
            required
            value={tenantId || ""}
            onChange={(e) => setTenantId(Number(e.target.value))}
            className="h-8 min-w-[14rem] rounded-[4px] border border-border px-2 text-[13px]"
          >
            <option value="" disabled>
              Select…
            </option>
            {tenants.map((t) => (
              <option key={t.id} value={t.id}>
                {t.tradingName} ({t.slug})
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] text-muted uppercase">Month</span>
          <input
            type="month"
            required
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="h-8 rounded-[4px] border border-border px-2 font-mono text-[13px]"
          />
        </label>
        <div className="flex flex-col justify-end gap-1 text-[12px] text-muted">
          <span>
            Period {period.start} → {period.end}
          </span>
        </div>
      </div>

      <label className="flex items-center gap-2 text-[13px]">
        <input
          type="checkbox"
          checked={seed}
          onChange={(e) => setSeed(e.target.checked)}
        />
        Seed from package &amp; expenses (and keep as starting lines)
      </label>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={seedPending || !tenantId}
          onClick={loadSeed}
          className="h-8 rounded-[4px] border border-border px-3 text-[12px] font-semibold hover:border-primary-light hover:bg-primary hover:text-white disabled:opacity-60"
        >
          Load package lines
        </button>
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
          Add blank line
        </button>
      </div>
      {seedError ? (
        <p className="text-[12px] text-status-error">{seedError}</p>
      ) : null}

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
                  placeholder="0.00"
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

      <p className="text-[11px] text-muted">
        Preview total (ex VAT rules):{" "}
        <span className="font-mono">
          {formatCentsPlain(
            lines.reduce((s, l) => {
              const unit = Number(String(l.unit).replace(",", ".")) || 0;
              return s + Math.round(unit * 100) * (l.quantity || 0);
            }, 0),
          )}
        </span>
      </p>

      {state.error ? (
        <p className="text-[12px] text-status-error">{state.error}</p>
      ) : null}

      <button
        type="submit"
        disabled={pending || !tenantId}
        className="h-8 rounded-[4px] bg-accent-strong px-4 text-[12px] font-semibold text-white hover:bg-primary disabled:opacity-60"
      >
        Save custom draft
      </button>
    </form>
  );
}
