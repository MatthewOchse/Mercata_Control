/**
 * Inline-style token map for HTML email clients (no CSS variables / webfonts).
 * Georgia stands in for Spectral; system sans for Plex.
 */

export const emailTokens = {
  foreground: "#121820",
  muted: "#5C6470",
  border: "#E2E0DB",
  surface: "#FFFFFF",
  background: "#F8F7F5",
  /** Explicit light panel so dark-mode clients don't invert body text poorly */
  bodyBg: "#F8F7F5",
  positive: "#2E6B4F",
  negative: "#9B1D20",
  fontSerif: "Georgia, 'Times New Roman', Times, serif",
  fontSans:
    "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
} as const;

export function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
