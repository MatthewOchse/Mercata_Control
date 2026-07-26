#!/usr/bin/env tsx
/** One-shot: verify operator password/TOTP and print a fresh current code. */
import "dotenv/config";
import mysql from "mysql2/promise";
import type { RowDataPacket } from "mysql2/promise";
import { generate } from "otplib";
import { verifyPassword } from "../src/lib/auth/password";
import { verifyTotp } from "../src/lib/auth/totp";

async function main() {
  const url = process.env.DATABASE_URL?.trim();
  const password = process.env.OPERATOR_PASSWORD;
  if (!url || !password) throw new Error("DATABASE_URL and OPERATOR_PASSWORD required");

  const conn = await mysql.createConnection(url);
  try {
    const [rows] = await conn.execute<RowDataPacket[]>(
      `SELECT password_hash, totp_secret, totp_confirmed FROM operators WHERE email = ? LIMIT 1`,
      ["admin@mercata.co.za"],
    );
    const row = rows[0];
    if (!row) throw new Error("operator not found");

    console.log("totp_confirmed:", row.totp_confirmed);
    console.log("secret:", row.totp_secret);
    console.log("password_ok El2607g#:", await verifyPassword(row.password_hash, password));
    console.log(
      "password_ok El2607g:",
      await verifyPassword(row.password_hash, "El2607g"),
    );

    const token = await generate({ secret: String(row.totp_secret) });
    console.log("server_totp_now:", token);
    console.log("verify_server_totp:", verifyTotp(String(row.totp_secret), token));
  } finally {
    await conn.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
