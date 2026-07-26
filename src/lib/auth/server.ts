import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  destroySession,
  getSessionOperator,
  SESSION_COOKIE,
  type Operator,
} from "@/lib/auth/session";

export async function getCurrentOperator(): Promise<Operator | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  return getSessionOperator(token);
}

export async function requireOperator(): Promise<Operator> {
  const operator = await getCurrentOperator();
  if (!operator) {
    redirect("/login");
  }
  return operator;
}

/** Fleet provision UI + enqueue — super-admins only. */
export async function requireSuperAdmin(): Promise<Operator> {
  const operator = await requireOperator();
  if (!operator.is_super) {
    throw new Error("Forbidden: super-admin only");
  }
  return operator;
}

export async function logoutCurrentSession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) {
    await destroySession(token);
  }
  jar.set(SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: new Date(0),
  });
}
