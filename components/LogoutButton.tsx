"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/** Small "Log out" button — clears the session cookie and returns to /login. */
export default function LogoutButton() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function onClick() {
    setLoading(true);
    try {
      await fetch("/api/logout", { method: "POST" });
    } catch {
      // Ignore network errors — we redirect to /login either way.
    }
    router.replace("/login");
    router.refresh();
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={loading}
      className="whitespace-nowrap rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
    >
      {loading ? "Logging out…" : "Log out"}
    </button>
  );
}
