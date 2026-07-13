/** UTC storage / Africa/Johannesburg display helpers. */

const SAST = "Africa/Johannesburg";

export function nowUtc(): Date {
  return new Date();
}

export function formatSastDate(
  value: Date | string | null | undefined,
  options: Intl.DateTimeFormatOptions = {
    year: "numeric",
    month: "short",
    day: "2-digit",
  },
): string {
  if (!value) return "—";
  const date = typeof value === "string" ? new Date(value) : value;
  return new Intl.DateTimeFormat("en-ZA", {
    timeZone: SAST,
    ...options,
  }).format(date);
}

export function formatSastDateTime(
  value: Date | string | null | undefined,
): string {
  return formatSastDate(value, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export function sastYear(date: Date = new Date()): number {
  const parts = new Intl.DateTimeFormat("en-ZA", {
    timeZone: SAST,
    year: "numeric",
  }).formatToParts(date);
  return Number(parts.find((p) => p.type === "year")?.value);
}
