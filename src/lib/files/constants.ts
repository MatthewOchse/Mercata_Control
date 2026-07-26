export const BUSINESS_FILE_CATEGORIES = [
  "general",
  "contract",
  "legal",
  "onboarding",
  "finance",
  "technical",
  "other",
] as const;

export type BusinessFileCategory = (typeof BUSINESS_FILE_CATEGORIES)[number];

export const MAX_BUSINESS_FILE_BYTES = 25 * 1024 * 1024;

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function categoryLabel(category: string): string {
  const map: Record<string, string> = {
    general: "General",
    contract: "Contract",
    legal: "Legal",
    onboarding: "Onboarding",
    finance: "Finance",
    technical: "Technical",
    other: "Other",
  };
  return map[category] ?? category;
}
