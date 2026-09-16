import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, sessionToken, safeEqual } from "@/lib/auth";

// Single shared password for the whole site (pages + API), enforced via a
// signed session cookie. The password comes from an env var so it's never in
// the bundle:
//
//   SITE_PASSWORD=some-long-shared-password
//
// If it's unset the gate is disabled (fail-open) so the site still works before
// the var is configured — set it to turn protection on. Visitors without a
// valid session cookie are sent to the /login page (API calls get a 401).

export async function middleware(req: NextRequest) {
  const pass = process.env.SITE_PASSWORD;
  if (!pass) return NextResponse.next(); // protection not configured

  const { pathname } = req.nextUrl;

  // The login page and its API must be reachable while signed out.
  if (pathname === "/login" || pathname === "/api/login") {
    return NextResponse.next();
  }

  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (token) {
    const expected = await sessionToken(pass);
    if (safeEqual(token, expected)) return NextResponse.next();
  }

  // API routes get a machine-readable 401 rather than an HTML redirect.
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  // Everything else goes to the login page, remembering where they were headed.
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  url.searchParams.set("next", pathname + req.nextUrl.search);
  return NextResponse.redirect(url);
}

// Protect everything except Next's static assets and the favicon.
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
