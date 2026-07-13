"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import {
  clearLoginFailures,
  getLoginLockStatus,
  recordLoginFailure,
} from "@/lib/auth/lockout";
import {
  loginWithPasswordAndTotp,
  SESSION_COOKIE,
} from "@/lib/auth/session";
import { logoutCurrentSession } from "@/lib/auth/server";

export type LoginState = {
  error?: string;
};

function clientIp(hdrs: Headers): string {
  return (
    hdrs.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    hdrs.get("x-real-ip")?.trim() ||
    "unknown"
  );
}

export async function loginAction(
  _prev: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const totp = String(formData.get("totp") ?? "").trim();
  const next = String(formData.get("next") ?? "/") || "/";

  if (!email || !password || !totp) {
    return { error: "Email, password, and authenticator code are required." };
  }

  const hdrs = await headers();
  const ip = clientIp(hdrs);

  const lock = await getLoginLockStatus(ip, email);
  if (lock.locked) {
    const mins = Math.max(1, Math.ceil((lock.retryAfterSeconds ?? 60) / 60));
    return {
      error: `Too many failed attempts. Try again in about ${mins} minute(s).`,
    };
  }

  const result = await loginWithPasswordAndTotp({
    email,
    password,
    totp,
    userAgent: hdrs.get("user-agent"),
    ip,
  });

  if ("error" in result) {
    const after = await recordLoginFailure(ip, email);
    if (after.locked) {
      return {
        error:
          "Too many failed attempts. Account login locked for 15 minutes.",
      };
    }
    return { error: result.error };
  }

  await clearLoginFailures(ip, email);

  const jar = await cookies();
  jar.set(SESSION_COOKIE, result.token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: result.expiresAt,
  });

  redirect(next.startsWith("/") ? next : "/");
}

export async function logoutAction(): Promise<void> {
  await logoutCurrentSession();
  redirect("/login");
}
