function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

function optional(name: string, fallback = ""): string {
  return process.env[name]?.trim() || fallback;
}

export function getDatabaseUrl(): string {
  return required("DATABASE_URL");
}

export function getSessionSecret(): string {
  return required("SESSION_SECRET");
}

export function isVatRegistered(): boolean {
  return optional("VAT_REGISTERED", "false").toLowerCase() === "true";
}

export function getAppUrl(): string {
  return optional("APP_URL", "http://localhost:3000");
}

export function getEncryptionKey(): string {
  return optional("ENCRYPTION_KEY", "");
}
