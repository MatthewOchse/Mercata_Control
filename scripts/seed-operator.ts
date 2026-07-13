#!/usr/bin/env tsx
/**
 * Seed (or rotate) the single operator account.
 * There is no registration UI — this is the only way to create the operator.
 *
 * Usage:
 *   OPERATOR_EMAIL=you@mercata.co.za OPERATOR_PASSWORD='…' npm run seed:operator
 *
 * Prints a TOTP provisioning URI and QR on first seed / rotation.
 * After scanning, re-run with CONFIRM_TOTP=1 to enable login.
 */
import "dotenv/config";
import mysql from "mysql2/promise";
import type { RowDataPacket } from "mysql2/promise";
import QRCode from "qrcode";
import { hashPassword } from "../src/lib/auth/password";
import { createTotpSecret, totpUri } from "../src/lib/auth/totp";

async function main() {
  const url = process.env.DATABASE_URL?.trim();
  const email = process.env.OPERATOR_EMAIL?.trim().toLowerCase();
  const password = process.env.OPERATOR_PASSWORD;
  const displayName = process.env.OPERATOR_NAME?.trim() || "Operator";
  const confirmTotp = process.env.CONFIRM_TOTP === "1";
  const rotateTotp = process.env.ROTATE_TOTP === "1";

  if (!url) {
    console.error("DATABASE_URL is required");
    process.exit(1);
  }
  if (!email || !password) {
    console.error("OPERATOR_EMAIL and OPERATOR_PASSWORD are required");
    process.exit(1);
  }
  if (password.length < 12) {
    console.error("OPERATOR_PASSWORD must be at least 12 characters");
    process.exit(1);
  }

  const conn = await mysql.createConnection(url);
  try {
    const [existing] = await conn.execute<RowDataPacket[]>(
      `SELECT id, totp_secret, totp_confirmed FROM operators WHERE email = ? LIMIT 1`,
      [email],
    );
    const row = existing[0] as
      | { id: number; totp_secret: string; totp_confirmed: number }
      | undefined;

    const passwordHash = await hashPassword(password);

    if (!row) {
      const secret = createTotpSecret();
      await conn.execute(
        `INSERT INTO operators (email, password_hash, totp_secret, totp_confirmed, display_name)
         VALUES (?, ?, ?, 0, ?)`,
        [email, passwordHash, secret, displayName],
      );
      console.log(`Created operator ${email}`);
      await printEnrolment(secret, email);
      return;
    }

    let secret = row.totp_secret;
    let totpConfirmed = row.totp_confirmed ? 1 : 0;
    let showEnrolment = false;

    if (rotateTotp || !row.totp_confirmed) {
      secret = createTotpSecret();
      totpConfirmed = 0;
      showEnrolment = true;
    }
    if (confirmTotp) {
      totpConfirmed = 1;
    }

    await conn.execute(
      `UPDATE operators
       SET password_hash = ?,
           totp_secret = ?,
           totp_confirmed = ?,
           display_name = ?
       WHERE id = ?`,
      [passwordHash, secret, totpConfirmed, displayName, row.id],
    );
    console.log(`Updated operator ${email}`);

    if (showEnrolment) {
      await printEnrolment(secret, email);
    } else if (confirmTotp) {
      console.log("Operator is ready to log in with email + password + TOTP.");
    }
  } finally {
    await conn.end();
  }
}

async function printEnrolment(secret: string, email: string) {
  const uri = totpUri(secret, email);
  console.log("\nScan this with your authenticator app:\n");
  console.log(uri);
  console.log("");
  console.log(await QRCode.toString(uri, { type: "terminal", small: true }));
  console.log(
    "\nAfter scanning, re-run with CONFIRM_TOTP=1 (same password) to enable login.",
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
