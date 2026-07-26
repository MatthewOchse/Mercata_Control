"use client";

type Series = {
  id: string;
  label: string;
  values: number[];
  /** solid | dashed */
  style?: "solid" | "dashed";
  color?: string;
};

type PointLabel = {
  /** Short X tick — leave blank to skip */
  label: string;
};

function niceMax(max: number): number {
  if (max <= 0) return 1;
  const mag = 10 ** Math.floor(Math.log10(max));
  const n = max / mag;
  const nice = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return nice * mag;
}

function formatTick(n: number): string {
  if (!Number.isFinite(n)) return "0";
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}m`;
  if (abs >= 10_000) return `${Math.round(n / 1000)}k`;
  if (abs >= 1000) return `${(n / 1000).toFixed(1)}k`;
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(1);
}

function formatZar(n: number): string {
  if (!Number.isFinite(n)) return "R0";
  const abs = Math.abs(n);
  if (abs >= 1000) return `R${(n / 1000).toFixed(1)}k`;
  return `R${Math.round(n)}`;
}

function formatMs(n: number): string {
  return `${Math.round(n)}ms`;
}

/** Named presets are safe to pass from Server Components (functions are not). */
export type ChartFormat = "number" | "zar" | "ms";

function resolveFormat(
  format: ChartFormat | undefined,
  yFormat: ((n: number) => string) | undefined,
): (n: number) => string {
  if (yFormat) return yFormat;
  if (format === "zar") return formatZar;
  if (format === "ms") return formatMs;
  return formatTick;
}

/**
 * Multi-series line chart with axes, labels, and legend.
 * Avoids cut-off by padding the viewBox for axis text.
 */
export function LineChart({
  series,
  xLabels,
  height = 160,
  format,
  yFormat,
  emptyText = "No chart data",
}: {
  series: Series[];
  xLabels: PointLabel[];
  height?: number;
  /** Prefer this from Server Components — functions cannot cross the boundary. */
  format?: ChartFormat;
  /** Client Components only. Prefer `format` when rendering from a server page. */
  yFormat?: (n: number) => string;
  emptyText?: string;
}) {
  const fmt = resolveFormat(format, yFormat);
  const n = Math.max(
    xLabels.length,
    ...series.map((s) => s.values.length),
    0,
  );
  if (n < 2 || series.every((s) => s.values.every((v) => v === 0) && s.values.length < 2)) {
    const hasAny = series.some((s) => s.values.length >= 2);
    if (!hasAny) {
      return (
        <p className="py-6 text-center text-[12px] text-muted">{emptyText}</p>
      );
    }
  }
  if (n < 2) {
    return (
      <p className="py-6 text-center text-[12px] text-muted">{emptyText}</p>
    );
  }

  const allVals = series.flatMap((s) => s.values.slice(0, n));
  const rawMax = Math.max(0, ...allVals);
  const yMax = niceMax(rawMax);
  const yMin = 0;

  const W = 640;
  const H = height;
  const padL = 44;
  const padR = 12;
  const padT = 12;
  const padB = 28;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;

  const toX = (i: number) =>
    padL + (i / Math.max(1, n - 1)) * innerW;
  const toY = (v: number) =>
    padT + innerH - ((v - yMin) / Math.max(yMax - yMin, 1)) * innerH;

  const yTicks = [0, 0.5, 1].map((t) => yMin + (yMax - yMin) * t);

  // X labels: first, middle, last (and more if short series)
  const xTickIdx =
    n <= 5
      ? Array.from({ length: n }, (_, i) => i)
      : [0, Math.floor((n - 1) / 2), n - 1];

  return (
    <div className="w-full">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full"
        role="img"
        preserveAspectRatio="xMidYMid meet"
      >
        {/* Grid + Y axis */}
        {yTicks.map((t) => (
          <g key={`y-${t}`}>
            <line
              x1={padL}
              x2={W - padR}
              y1={toY(t)}
              y2={toY(t)}
              stroke="var(--border)"
              strokeWidth="1"
            />
            <text
              x={padL - 6}
              y={toY(t)}
              textAnchor="end"
              dominantBaseline="middle"
              fill="var(--muted)"
              style={{ fontSize: 10, fontFamily: "var(--font-plex-mono), monospace" }}
            >
              {fmt(t)}
            </text>
          </g>
        ))}

        {/* X axis ticks */}
        {xTickIdx.map((i) => {
          const label = xLabels[i]?.label ?? "";
          if (!label) return null;
          return (
            <text
              key={`x-${i}`}
              x={toX(i)}
              y={H - 8}
              textAnchor={i === 0 ? "start" : i === n - 1 ? "end" : "middle"}
              fill="var(--muted)"
              style={{ fontSize: 10, fontFamily: "var(--font-plex-mono), monospace" }}
            >
              {label}
            </text>
          );
        })}

        {series.map((s) => {
          const pts = s.values
            .slice(0, n)
            .map((v, i) => `${toX(i)},${toY(v)}`)
            .join(" ");
          return (
            <polyline
              key={s.id}
              fill="none"
              stroke={s.color ?? "var(--primary)"}
              strokeWidth="2"
              strokeDasharray={s.style === "dashed" ? "5 4" : undefined}
              strokeLinejoin="round"
              strokeLinecap="round"
              points={pts}
            />
          );
        })}
      </svg>

      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted">
        {series.map((s) => (
          <li key={s.id} className="inline-flex items-center gap-1.5">
            <span
              aria-hidden
              className="inline-block w-5 border-t-2"
              style={{
                borderColor: s.color ?? "var(--primary)",
                borderStyle: s.style === "dashed" ? "dashed" : "solid",
              }}
            />
            <span>{s.label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function BarChart({
  values,
  xLabels,
  height = 140,
  format,
  yFormat,
  barColor = "var(--primary)",
  emptyText = "No chart data",
}: {
  values: number[];
  xLabels: PointLabel[];
  height?: number;
  format?: ChartFormat;
  yFormat?: (n: number) => string;
  barColor?: string;
  emptyText?: string;
}) {
  const fmt = resolveFormat(format, yFormat);
  const n = values.length;
  if (n === 0) {
    return (
      <p className="py-6 text-center text-[12px] text-muted">{emptyText}</p>
    );
  }

  const yMax = niceMax(Math.max(0, ...values));
  const W = 640;
  const H = height;
  const padL = 44;
  const padR = 12;
  const padT = 12;
  const padB = 28;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;
  const gap = n > 40 ? 1 : n > 20 ? 2 : 3;
  const barW = Math.max(2, (innerW - gap * (n - 1)) / n);

  const toY = (v: number) =>
    padT + innerH - (v / Math.max(yMax, 1)) * innerH;

  const yTicks = [0, 0.5, 1].map((t) => yMax * t);
  const xTickIdx =
    n <= 5
      ? Array.from({ length: n }, (_, i) => i)
      : [0, Math.floor((n - 1) / 2), n - 1];

  return (
    <div className="w-full">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full"
        role="img"
        preserveAspectRatio="xMidYMid meet"
      >
        {yTicks.map((t) => (
          <g key={`y-${t}`}>
            <line
              x1={padL}
              x2={W - padR}
              y1={toY(t)}
              y2={toY(t)}
              stroke="var(--border)"
              strokeWidth="1"
            />
            <text
              x={padL - 6}
              y={toY(t)}
              textAnchor="end"
              dominantBaseline="middle"
              fill="var(--muted)"
              style={{ fontSize: 10, fontFamily: "var(--font-plex-mono), monospace" }}
            >
              {fmt(t)}
            </text>
          </g>
        ))}
        {values.map((v, i) => {
          const x = padL + i * (barW + gap);
          const y = toY(v);
          const h = padT + innerH - y;
          return (
            <rect
              key={i}
              x={x}
              y={y}
              width={barW}
              height={Math.max(0, h)}
              fill={barColor}
            >
              <title>{`${xLabels[i]?.label ?? ""}: ${fmt(v)}`}</title>
            </rect>
          );
        })}
        {xTickIdx.map((i) => {
          const label = xLabels[i]?.label ?? "";
          if (!label) return null;
          const x = padL + i * (barW + gap) + barW / 2;
          return (
            <text
              key={`x-${i}`}
              x={x}
              y={H - 8}
              textAnchor={i === 0 ? "start" : i === n - 1 ? "end" : "middle"}
              fill="var(--muted)"
              style={{ fontSize: 10, fontFamily: "var(--font-plex-mono), monospace" }}
            >
              {label}
            </text>
          );
        })}
      </svg>
    </div>
  );
}

/** Short MM-DD from YYYY-MM-DD */
export function shortDateLabel(iso: string): string {
  const d = iso.slice(0, 10);
  if (d.length < 10) return d;
  return `${d.slice(5, 7)}-${d.slice(8, 10)}`;
}
