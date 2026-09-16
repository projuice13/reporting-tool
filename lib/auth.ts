// Shared helpers for the cookie-based login gate.
//
// A single shared password protects the whole site. On a successful login we
// set an HttpOnly cookie whose value is an HMAC of a fixed marker, keyed by the
// password. The middleware can then verify the cookie on every request without
// any server-side session store. Because the token is derived from the
// password, changing SITE_PASSWORD invalidates all existing sessions.
//
// Everything here uses the Web Crypto API so it runs in both the Edge
// (middleware) and Node (route handler) runtimes.

/** Name of the session cookie set after a successful login. */
export const SESSION_COOKIE = "pj_session";

/** How long a login stays valid, in seconds (30 days). */
export const SESSION_MAX_AGE = 60 * 60 * 24 * 30;

/** HMAC-SHA256 of a fixed marker, keyed by the shared password, as hex. */
export async function sessionToken(password: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(password),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode("projuice-authenticated-v1"));
  const bytes = new Uint8Array(sig);
  let hex = "";
  for (const b of bytes) hex += b.toString(16).padStart(2, "0");
  return hex;
}

/** Constant-time string compare (avoids leaking a match via timing). */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}
