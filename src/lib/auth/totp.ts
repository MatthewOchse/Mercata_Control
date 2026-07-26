import { generateSecret, generateURI, verifySync } from "otplib";

export function createTotpSecret(): string {
  return generateSecret();
}

export function totpUri(secret: string, email: string): string {
  return generateURI({
    issuer: "Mercata Admin",
    label: email,
    secret,
  });
}

export function verifyTotp(secret: string, token: string): boolean {
  // ±1 step (30s) tolerance for phone clock skew
  const result = verifySync({
    secret,
    token: token.trim().replace(/\s+/g, ""),
    epochTolerance: 30,
  });
  return result.valid === true;
}
