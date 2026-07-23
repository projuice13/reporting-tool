"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { CohortResponse } from "@/lib/types";

const gbp = new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: 0 });
const gbp2 = new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", minimumFractionDigits: 2 });
const money = (v: number | null | undefined) => (v == null ? "—" : gbp2.format(v));

export default function CohortPage() {
  const [data, setData] = useState<CohortResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      const res = await fetch("/api/cohort");
      const body = await res.json();
      if (!res.ok) {
        setError(body?.error ?? `Failed to load (${res.status}).`);
        return;
      }
      setData(body as CohortResponse);
    } catch {
      setError("Network error loading the cohort.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function refresh() {
    setRefreshing(true);
    setError("");
    try {
      const res = await fetch("/api/cohort/refresh", { method: "POST" });
      const body = await res.json();
      if (!res.ok) {
        setError(body?.error ?? `Refresh failed (${res.status}).`);
        return;
      }
      setData(body as CohortResponse);
    } catch {
      setError("Network error during refresh.");
    } finally {
      setRefreshing(false);
    }
  }

  async function remove(id: number, company: string) {
    if (!confirm(`Remove ${company} from the cohort?`)) return;
    try {
      const res = await fetch(`/api/cohort?id=${id}`, { method: "DELETE" });
      if (res.ok) load();
    } catch {
      /* ignore */
    }
  }

  const customers = data?.customers ?? [];
  const summary = data?.summary ?? [];
  const refreshedLabel = data?.spendRefreshedAt
    ? new Date(data.spendRefreshedAt).toLocaleString("en-GB")
    : "never";

  return (
    <main className="px-4 py-10">
      <div className="mx-auto max-w-[1200px]">
        <header className="mb-6 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Cohort — new customer value</h1>
            <p className="mt-1 text-sm text-slate-500">
              Confirmed new customers and their website spend over time, grouped by acquisition source.
              Spend last refreshed: <span className="font-medium text-slate-700">{refreshedLabel}</span>.
            </p>
          </div>
          <div className="flex gap-2">
            <Link href="/" className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50">
              ← New report
            </Link>
            <button
              type="button"
              onClick={refresh}
              disabled={refreshing || customers.length === 0}
              className="inline-flex items-center gap-2 rounded-md bg-slate-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-40"
            >
              {refreshing ? "Refreshing…" : "Refresh spend"}
            </button>
          </div>
        </header>

        {error && <div className="mb-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}

        {loading ? (
          <p className="text-sm text-slate-500">Loading…</p>
        ) : customers.length === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">
            No customers saved yet. Run a report on the{" "}
            <Link href="/" className="underline">
              new report
            </Link>{" "}
            page and click “Confirm &amp; save report”.
          </div>
        ) : (
          <div className="space-y-8">
            {/* Value by source */}
            <section>
              <h2 className="mb-2 text-base font-semibold text-slate-800">Value by acquisition source</h2>
              <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                      <th className="px-3 py-2 font-medium">Source</th>
                      <th className="px-3 py-2 font-medium">Customers</th>
                      <th className="px-3 py-2 font-medium">Acq. value</th>
                      <th className="px-3 py-2 font-medium">Total spend</th>
                      <th className="px-3 py-2 font-medium">Avg / month</th>
                      <th className="px-3 py-2 font-medium">Avg @6m</th>
                      <th className="px-3 py-2 font-medium">Avg @12m</th>
                      <th className="px-3 py-2 font-medium">Avg @18m</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.map((s) => (
                      <tr key={s.attribution} className="border-b border-slate-100 hover:bg-slate-50">
                        <td className="px-3 py-2 font-medium text-slate-800">{s.attribution}</td>
                        <td className="px-3 py-2 tabular-nums">{s.customers}</td>
                        <td className="px-3 py-2 tabular-nums">{money(s.totalAcqValue)}</td>
                        <td className="px-3 py-2 tabular-nums">{money(s.totalSpend)}</td>
                        <td className="px-3 py-2 tabular-nums">{money(s.avgMonthlySpend)}</td>
                        <td className="px-3 py-2 tabular-nums" title={`${s.mature6m} mature`}>
                          {s.mature6m ? gbp.format(s.avg6m) : "—"}
                        </td>
                        <td className="px-3 py-2 tabular-nums" title={`${s.mature12m} mature`}>
                          {s.mature12m ? gbp.format(s.avg12m) : "—"}
                        </td>
                        <td className="px-3 py-2 tabular-nums" title={`${s.mature18m} mature`}>
                          {s.mature18m ? gbp.format(s.avg18m) : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-2 text-xs text-slate-400">
                “Avg @6/12/18m” = average spend within that many months of acquisition, averaged over only the
                customers old enough to have reached that tenure (hover for the count).
              </p>
            </section>

            {/* Customers */}
            <section>
              <h2 className="mb-2 text-base font-semibold text-slate-800">
                Customers <span className="text-sm font-normal text-slate-400">({customers.length})</span>
              </h2>
              <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                      <th className="px-3 py-2 font-medium">Company</th>
                      <th className="px-3 py-2 font-medium">Attribution</th>
                      <th className="px-3 py-2 font-medium">Acquired</th>
                      <th className="px-3 py-2 font-medium">Acq. £</th>
                      <th className="px-3 py-2 font-medium">Orders</th>
                      <th className="px-3 py-2 font-medium">Total spend</th>
                      <th className="px-3 py-2 font-medium">Avg / mo</th>
                      <th className="px-3 py-2 font-medium">Months</th>
                      <th className="px-3 py-2 font-medium">Last order</th>
                      <th className="px-3 py-2 font-medium"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {customers.map((c) => {
                      const noIdentity = !c.email && !c.wcCustomerId;
                      return (
                        <tr key={c.id} className="border-b border-slate-100 align-top hover:bg-slate-50">
                          <td className="px-3 py-2">
                            <div className="font-medium text-slate-800">{c.company}</div>
                            <div className="text-xs text-slate-400">{c.postcode}</div>
                          </td>
                          <td className="px-3 py-2 text-slate-700">
                            {c.attribution}
                            {c.attributionSource === "manual" && (
                              <span className="ml-1 rounded bg-slate-100 px-1 text-[10px] uppercase text-slate-500">manual</span>
                            )}
                          </td>
                          <td className="px-3 py-2 whitespace-nowrap text-slate-600">{c.acqDate ?? "—"}</td>
                          <td className="px-3 py-2 tabular-nums text-slate-600">{money(c.acqTotal)}</td>
                          <td className="px-3 py-2 tabular-nums text-slate-600">{c.orderCount ?? "—"}</td>
                          <td className="px-3 py-2 tabular-nums text-slate-800">{money(c.totalSpend)}</td>
                          <td className="px-3 py-2 tabular-nums text-slate-600">{money(c.avgMonthlySpend)}</td>
                          <td className="px-3 py-2 tabular-nums text-slate-600">{c.monthsTracked ?? "—"}</td>
                          <td className="px-3 py-2 whitespace-nowrap text-slate-600">
                            {noIdentity ? (
                              <span className="text-xs text-amber-600" title="No email/customer id — website spend can't be tracked">
                                no identity
                              </span>
                            ) : (
                              c.lastOrderDate ?? "—"
                            )}
                          </td>
                          <td className="px-3 py-2">
                            <button
                              type="button"
                              onClick={() => remove(c.id, c.company)}
                              className="text-xs text-slate-400 hover:text-red-600"
                              title="Remove from cohort"
                            >
                              ✕
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p className="mt-2 text-xs text-slate-400">
                Spend is pulled from live WooCommerce orders (processing + completed) by matching each customer’s
                email / customer id. Click <span className="font-medium">Refresh spend</span> to recompute.
              </p>
            </section>
          </div>
        )}
      </div>
    </main>
  );
}
