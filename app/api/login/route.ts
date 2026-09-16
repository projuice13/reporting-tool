import { NextResponse } from "next/server";
import { SESSION_COOKIE, SESSION_MAX_AGE, sessionToken, safeEqual } from "@/lib/auth";

// Verifies the shared password and, on success, sets the session cookie the
// middleware checks. No username — a single password gates the whole site.

export async function POST(req: Request) {
  const pass = process.env.SITE_PASSWORD;

  // Gate disabled (no password configured) — treat any login as a success so
  // the site stays usable before the env var is set.
  if (!pass) return NextResponse.json({ ok: true });

  let submitted = "";
  try {
    const body = await req.json();
    if (body && typeof body.password === "string") submitted = body.password;
  } catch {
    submitted = "";
  }

  if (!safeEqual(submitted, pass)) {
    return NextResponse.json({ ok: false, error: "Incorrect password." }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, await sessionToken(pass), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
  return res;
}
