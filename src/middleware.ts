import { NextRequest, NextResponse } from "next/server";
import {
  COMPANY_SESSION_COOKIE,
  isValidAdminSession,
  readCompanySession,
  SESSION_COOKIE,
} from "./lib/auth";

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (
    pathname === "/admin-panel/login"
    || pathname === "/api/auth/login"
    || pathname === "/api/auth/logout"
    || pathname === "/api/company-auth/login"
    || pathname === "/api/company-auth/logout"
    || pathname === "/login"
    || pathname.startsWith("/qr/live/")
    || pathname === "/api/qr/token"
  ) {
    return NextResponse.next();
  }

  if (pathname.startsWith("/admin-panel") || pathname.startsWith("/api/admin-panel/")) {
    const valid = await isValidAdminSession(request.cookies.get(SESSION_COOKIE)?.value);
    if (!valid) {
      if (pathname.startsWith("/api/")) {
        return NextResponse.json({ error: "Admin authentication required." }, { status: 401 });
      }
      return NextResponse.redirect(new URL("/admin-panel/login", request.url));
    }
    return NextResponse.next();
  }

  const companySession = await readCompanySession(request.cookies.get(COMPANY_SESSION_COOKIE)?.value);
  if (!companySession) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Company login required." }, { status: 401 });
    }
    const login = new URL("/login", request.url);
    login.searchParams.set("next", pathname);
    return NextResponse.redirect(login);
  }

  if (companySession.mustChangePassword && pathname !== "/change-password" && pathname !== "/api/company-auth/change-password") {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Change your temporary password before continuing.", code: "PASSWORD_CHANGE_REQUIRED" }, { status: 403 });
    }
    return NextResponse.redirect(new URL("/change-password", request.url));
  }

  if (!companySession.mustChangePassword && pathname === "/change-password") {
    return NextResponse.redirect(new URL("/staff", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
