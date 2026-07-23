import { NextResponse, type NextRequest } from "next/server";

// Single global username/password for the whole site (pages + API), via HTTP
// Basic Auth. Credentials come from env vars so they're never in the bundle:
//
//   SITE_USER=projuice
//   SITE_PASSWORD=some-long-shared-password
//
// If either is unset the gate is disabled (fail-open) so the site still works
// before the vars are configured — set both to turn protection on.

/** Constant-time string compare (avoids leaking a match via timing). */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}

export function middleware(req: NextRequest) {
  const user = process.env.SITE_USER;
  const pass = process.env.SITE_PASSWORD;
  if (!user || !pass) return NextResponse.next(); // protection not configured

  const header = req.headers.get("authorization");
  if (header) {
    const [scheme, encoded] = header.split(" ");
    if (scheme === "Basic" && encoded) {
      let decoded = "";
      try {
        decoded = atob(encoded);
      } catch {
        decoded = "";
      }
      const sep = decoded.indexOf(":");
      if (sep !== -1) {
        const u = decoded.slice(0, sep);
        const p = decoded.slice(sep + 1);
        if (safeEqual(u, user) && safeEqual(p, pass)) {
          return NextResponse.next();
        }
      }
    }
  }

  return new NextResponse("Authentication required.", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="ProJuice Attribution", charset="UTF-8"' },
  });
}

// Protect everything except Next's static assets and the favicon.
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
