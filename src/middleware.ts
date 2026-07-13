import { NextResponse, type NextRequest } from "next/server";
import {
  checkLoginIpRateLimit,
  LOGIN_RATE_LIMIT_PER_MINUTE,
} from "@/lib/auth/login-rate-limit";

const PUBLIC_PATHS = new Set(["/login"]);

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon") ||
    pathname.startsWith("/brand") ||
    pathname === "/api/health" ||
    pathname.startsWith("/api/cron/") ||
    pathname.startsWith("/api/digest/unsubscribe")
  ) {
    return NextResponse.next();
  }

  // Soft rate limit on /login POSTs (server actions + form posts).
  if (pathname === "/login" && request.method === "POST") {
    const ip =
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      request.headers.get("x-real-ip")?.trim() ||
      "unknown";
    const limit = checkLoginIpRateLimit(ip);
    if (!limit.allowed) {
      return NextResponse.json(
        {
          error: `Too many login requests. Limit is ${LOGIN_RATE_LIMIT_PER_MINUTE}/minute.`,
        },
        {
          status: 429,
          headers: {
            "Retry-After": String(limit.retryAfterSeconds ?? 60),
          },
        },
      );
    }
  }

  const isPublic = PUBLIC_PATHS.has(pathname);
  const session = request.cookies.get("mercata_session")?.value;

  if (!session && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  if (session && pathname === "/login") {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};
