import { accessCookieName } from "@/lib/supabase-server";
import { NextResponse, type NextRequest } from "next/server";

const protectedRoutes = ["/dashboard", "/users", "/aznif", "/treasury", "/economy"];

export function middleware(request: NextRequest) {
  const isProtected = protectedRoutes.some((route) => request.nextUrl.pathname.startsWith(route));
  const hasAccessToken = Boolean(request.cookies.get(accessCookieName)?.value);

  if (isProtected && !hasAccessToken) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  if (request.nextUrl.pathname === "/login" && hasAccessToken) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/dashboard/:path*", "/users/:path*", "/aznif/:path*", "/treasury/:path*", "/economy/:path*", "/login"],
};
