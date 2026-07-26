/**
 * Redact secret values from strings before they hit job logText or stdout.
 * Values are registered as they are generated/loaded; never log the raw map.
 */

const SECRET_ENV_KEY_RE =
  /^(AUTH_SECRET|NEXTAUTH_SECRET|STORE_ADMIN_SECRET|CRAFTIES_ADMIN_SECRET|FLEET_SECRET|MYSQL_PASSWORD|PROVISION_MYSQL_PASSWORD|PROVISION_ADMIN_PASSWORD|ADMIN_PASSWORD|PAYFAST_|SHIPLOGIC_|TCG_LOCKER_|SMTP_PASS|SMTP_PASSWORD)/i;

/** Keys whose values must never appear in logs. */
export function isSecretEnvKey(key: string): boolean {
  const k = key.trim();
  if (SECRET_ENV_KEY_RE.test(k)) return true;
  if (/PASSWORD|SECRET|PASSPHRASE|API_KEY|TOKEN|PRIVATE/i.test(k)) return true;
  return false;
}

export class SecretRedactor {
  private readonly values = new Set<string>();

  /** Register a plaintext secret so future redact() calls strip it. */
  track(value: string | null | undefined): void {
    const v = value?.trim() ?? "";
    if (v.length < 4) return; // too short — avoid nuking common words
    this.values.add(v);
  }

  trackMany(map: Record<string, string | undefined | null>): void {
    for (const [key, value] of Object.entries(map)) {
      if (isSecretEnvKey(key)) this.track(value);
      else if (value && /PASSWORD|SECRET|PASSPHRASE|API_KEY|TOKEN/i.test(key)) {
        this.track(value);
      }
    }
  }

  /** Replace tracked secrets and common KEY=value secret lines. */
  redact(text: string): string {
    let out = text;
    // Longest first so substrings of longer secrets don't leave remnants.
    const sorted = [...this.values].sort((a, b) => b.length - a.length);
    for (const secret of sorted) {
      if (!secret) continue;
      out = out.split(secret).join("***");
    }
    // KEY=value lines for known secret keys (covers openssl / echo mishaps).
    out = out.replace(
      /^([A-Za-z0-9_]*(?:SECRET|PASSWORD|PASSPHRASE|API_KEY|TOKEN)[A-Za-z0-9_]*)\s*=\s*.+$/gim,
      "$1=***",
    );
    out = out.replace(
      /(--admin-pass|--password)\s+\S+/gi,
      "$1 ***",
    );
    // mysql -pPASSWORD (no space) and -p PASSWORD
    out = out.replace(/(\s-p)\S+/g, "$1***");
    out = out.replace(
      /(Authorization:\s*Bearer\s+)\S+/gi,
      "$1***",
    );
    return out;
  }

  /** Log-safe summary: key names only. */
  describeKeys(keys: string[]): string {
    return keys.length === 0 ? "(none)" : keys.sort().join(", ");
  }
}
