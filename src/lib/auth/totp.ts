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
  const result = verifySync({ secret, token: token.trim() });
  return result.valid === true;
}
