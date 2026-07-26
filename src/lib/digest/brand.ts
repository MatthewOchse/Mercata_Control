import { decryptSecret } from "@/lib/crypto/secrets";
import type { DigestBrand } from "@/lib/digest/types";

const FALLBACK_PRIMARY = "#1A2B4A";

function normaliseDomain(domain: string): string {
  return domain
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/$/, "");
}

function normaliseHex(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const t = raw.trim();
  if (/^#[0-9A-Fa-f]{6}$/.test(t)) return t.toUpperCase();
  if (/^[0-9A-Fa-f]{6}$/.test(t)) return `#${t.toUpperCase()}`;
  return null;
}

type LiveBrand = {
  primary_color?: string;
  primaryColor?: string;
  logo_url?: string;
  logoUrl?: string;
};

/**
 * Resolve tenant brand for digests.
 * Prefers live storefront/fleet brand when available; falls back to stored
 * brand_primary_color / brand_logo_url; finally Mercata navy.
 */
export async function resolveTenantBrand(opts: {
  tradingName: string;
  primaryDomain: string | null;
  fleetSecretCipher: string | null;
  storedPrimary: string | null;
  storedLogoUrl: string | null;
}): Promise<DigestBrand> {
  let primary =
    normaliseHex(opts.storedPrimary) ?? FALLBACK_PRIMARY;
  let logoUrl = opts.storedLogoUrl?.trim() || null;

  if (opts.primaryDomain && opts.fleetSecretCipher) {
    try {
      const host = normaliseDomain(opts.primaryDomain);
      const secret = decryptSecret(opts.fleetSecretCipher);
      const { fetchFleetAuthorized } = await import("@/lib/health/fleet-fetch");
      const res = await fetchFleetAuthorized(
        `https://${host}/api/_fleet/brand`,
        secret,
        { timeoutMs: 8000, userAgent: "MercataControl/digest-brand" },
      );
      if (res.ok) {
        const json = (await res.json()) as LiveBrand;
        const livePrimary = normaliseHex(
          json.primary_color ?? json.primaryColor,
        );
        if (livePrimary) primary = livePrimary;
        const liveLogo = (json.logo_url ?? json.logoUrl)?.trim();
        if (liveLogo) logoUrl = liveLogo;
      }
    } catch {
      // Live brand is best-effort; stored / fallback still apply.
    }
  }

  return {
    tradingName: opts.tradingName,
    primaryColor: primary,
    logoUrl,
  };
}

/** Text colour for logos / copy on the header band. */
export function contrastOnPrimary(hex: string): string {
  const h = normaliseHex(hex) ?? FALLBACK_PRIMARY;
  const r = parseInt(h.slice(1, 3), 16);
  const g = parseInt(h.slice(3, 5), 16);
  const b = parseInt(h.slice(5, 7), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.55 ? "#121820" : "#FFFFFF";
}
