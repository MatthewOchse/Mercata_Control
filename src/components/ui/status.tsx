import { cn } from "@/lib/cn";
import { formatZAR } from "@/lib/money";

export type StatusTone = "ok" | "warn" | "error" | "idle";

const TONE_CLASS: Record<StatusTone, string> = {
  ok: "text-status-ok border-status-ok/30 bg-status-ok/8",
  warn: "text-status-warn border-status-warn/30 bg-status-warn/8",
  error: "text-status-error border-status-error/30 bg-status-error/8",
  idle: "text-status-idle border-border bg-background",
};

const TONE_ICON: Record<StatusTone, string> = {
  ok: "●",
  warn: "▲",
  error: "■",
  idle: "○",
};

/** Status is never colour alone — icon + label required. */
export function StatusPill({
  tone,
  label,
}: {
  tone: StatusTone;
  label: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-[4px] border px-2 py-0.5 text-[11px] font-medium",
        TONE_CLASS[tone],
      )}
    >
      <span aria-hidden className="text-[9px] leading-none">
        {TONE_ICON[tone]}
      </span>
      {label}
    </span>
  );
}

export function Money({
  cents,
  className,
}: {
  cents: number;
  className?: string;
}) {
  return (
    <span data-money className={cn("tabular-nums", className)}>
      {formatZAR(cents)}
    </span>
  );
}
