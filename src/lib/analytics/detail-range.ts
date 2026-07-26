import { addDaysYmd, digestSastToday } from "@/lib/digest/period";

export type DetailRange = "1d" | "7d" | "28d" | "90d";

export const DETAIL_RANGES: DetailRange[] = ["1d", "7d", "28d", "90d"];

export const DEFAULT_DETAIL_RANGE: DetailRange = "1d";

export function isDetailRange(
  raw: string | null | undefined,
): raw is DetailRange {
  return raw === "1d" || raw === "7d" || raw === "28d" || raw === "90d";
}

/** Inclusive date window ending yesterday (SAST). `1d` = previous day only. */
export function resolveDetailRange(
  range: DetailRange,
  today: string = digestSastToday(),
): { from: string; to: string } {
  const yesterday = addDaysYmd(today, -1);
  if (range === "1d") {
    return { from: yesterday, to: yesterday };
  }
  const span = range === "7d" ? 6 : range === "28d" ? 27 : 89;
  return { from: addDaysYmd(yesterday, -span), to: yesterday };
}
