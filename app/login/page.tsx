"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (res.ok) {
        // Only follow same-site paths to avoid an open-redirect via ?next=.
        const next = params.get("next") || "/";
        const dest = next.startsWith("/") && !next.startsWith("//") ? next : "/";
        router.replace(dest);
        router.refresh();
      } else {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(data?.error || "Incorrect password.");
      }
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      className="w-full max-w-sm rounded-lg border border-slate-200 bg-white p-6 shadow-sm"
    >
      <h1 className="text-xl font-bold text-slate-900">ProJuice Attribution</h1>
      <p className="mt-1 text-sm text-slate-500">Enter the password to continue.</p>

      <label htmlFor="password" className="mt-6 block text-sm font-medium text-slate-700">
        Password
      </label>
      <input
        id="password"
        type="password"
        autoFocus
        autoComplete="current-password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-slate-900 outline-none focus:border-slate-500 focus:ring-1 focus:ring-slate-500"
      />

      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

      <button
        type="submit"
        disabled={loading || password.length === 0}
        className="mt-5 flex w-full items-center justify-center rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {loading ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-10">
      <Suspense fallback={null}>
        <LoginForm />
      </Suspense>
    </main>
  );
}
