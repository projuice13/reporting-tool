"use client";

import { useRef, useState } from "react";
import { parseCustomerCsv, CsvError, type ParseResult } from "@/lib/csv";
import { exportCsv, exportXlsx } from "@/lib/export";
import type { AttributeResponse } from "@/lib/types";
import AttributionSummary from "@/components/AttributionSummary";
import ResultsTable from "@/components/ResultsTable";

const ALL_STATUSES = [
  "processing",
  "completed",
  "on-hold",
  "pending",
  "refunded",
  "cancelled",
  "failed",
];

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Default range = the whole previous calendar month. */
function previousMonthRange(): { from: string; to: string } {
  const now = new Date();
  const first = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const last = new Date(now.getFullYear(), now.getMonth(), 0); // day 0 of this month = last day of prev
  return { from: ymd(first), to: ymd(last) };
}

export default function Home() {
  const defaults = previousMonthRange();
  const [parsed, setParsed] = useState<ParseResult | null>(null);
  const [fileName, setFileName] = useState<string>("");
  const [from, setFrom] = useState<string>(defaults.from);
  const [to, setTo] = useState<string>(defaults.to);
  const [statuses, setStatuses] = useState<string[]>(["processing", "completed"]);
  const [showStatuses, setShowStatuses] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>("");
  const [result, setResult] = useState<AttributeResponse | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const rangeInvalid = !from || !to || from > to;

  async function handleFile(file: File | undefined) {
    if (!file) return;
    setError("");
    setResult(null);
    setParsed(null);
    setFileName(file.name);
    try {
      const res = await parseCustomerCsv(file);
      setParsed(res);
    } catch (err) {
      const msg = err instanceof CsvError ? err.message : "Could not parse the CSV file.";
      setError(msg);
      setFileName("");
    }
  }

  function toggleStatus(s: string) {
    setStatuses((cur) => (cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s]));
  }

  async function run() {
    if (!parsed) return;
    setLoading(true);
    setError("");
    setResult(null);
    try {
      const res = await fetch("/api/attribute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customers: parsed.customers, from, to, statuses }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error ?? `Request failed (${res.status}).`);
        return;
      }
      setResult(data as AttributeResponse);
    } catch {
      setError("Network error contacting the server.");
    } finally {
      setLoading(false);
    }
  }

  const canRun = !!parsed && !loading && !rangeInvalid;
  const exportBase = `projuice-attribution-${from}_to_${to}`;

  return (
    <main className="px-4 py-10">
      <div className="mx-auto max-w-[720px]">
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">New Customer Attribution</h1>
        <p className="mt-1 text-sm text-slate-500">
          Upload a new-customer CSV, pick a month, and match each customer to their WooCommerce
          order to see how they were acquired.
        </p>
      </header>

      {/* Upload zone */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          handleFile(e.dataTransfer.files?.[0]);
        }}
        onClick={() => fileInputRef.current?.click()}
        className={`cursor-pointer rounded-lg border-2 border-dashed p-6 text-center transition ${
          dragOver ? "border-slate-500 bg-slate-100" : "border-slate-300 bg-white hover:bg-slate-50"
        }`}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={(e) => handleFile(e.target.files?.[0])}
        />
        <p className="text-sm text-slate-600">
          <span className="font-medium text-slate-800">Click to choose</span> or drag a{" "}
          <code className="rounded bg-slate-100 px-1">.csv</code> here
        </p>
        {parsed && (
          <p className="mt-2 text-sm font-medium text-green-700">
            ✓ {parsed.customers.length} customers loaded from {fileName}
          </p>
        )}
      </div>

      {parsed && (
        <button
          type="button"
          onClick={() => setShowPreview((v) => !v)}
          className="mt-2 text-xs text-slate-500 underline hover:text-slate-700"
        >
          {showPreview ? "Hide" : "Show"} preview · columns: {parsed.companyHeader} / {parsed.postcodeHeader}
          {parsed.amountHeader ? ` / ${parsed.amountHeader}` : ""}
        </button>
      )}
      {parsed && showPreview && (
        <div className="mt-2 overflow-x-auto rounded-md border border-slate-200 bg-white">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 text-left text-slate-500">
              <tr>
                <th className="px-2 py-1">Company</th>
                <th className="px-2 py-1">Postcode</th>
                <th className="px-2 py-1">Amount</th>
              </tr>
            </thead>
            <tbody>
              {parsed.customers.slice(0, 5).map((c) => (
                <tr key={c.rowIndex} className="border-t border-slate-100">
                  <td className="px-2 py-1">{c.company}</td>
                  <td className="px-2 py-1">{c.postcode || "—"}</td>
                  <td className="px-2 py-1">{c.amount ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Date range + status controls */}
      <div className="mt-5 flex flex-wrap items-end gap-3">
        <label className="text-sm">
          <span className="mb-1 block text-slate-600">Date from</span>
          <input
            type="date"
            value={from}
            max={to || undefined}
            onChange={(e) => setFrom(e.target.value)}
            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-slate-900"
          />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-slate-600">Date to</span>
          <input
            type="date"
            value={to}
            min={from || undefined}
            onChange={(e) => setTo(e.target.value)}
            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-slate-900"
          />
        </label>

        <button
          type="button"
          onClick={run}
          disabled={!canRun}
          className="ml-auto inline-flex items-center gap-2 rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {loading ? (
            <>
              <Spinner /> Fetching orders…
            </>
          ) : (
            "Run attribution"
          )}
        </button>
      </div>
      {rangeInvalid && (
        <p className="mt-1 text-xs text-red-600">The “from” date must be on or before the “to” date.</p>
      )}

      {/* Status filter (collapsed) */}
      <div className="mt-3">
        <button
          type="button"
          onClick={() => setShowStatuses((v) => !v)}
          className="text-xs text-slate-500 underline hover:text-slate-700"
        >
          {showStatuses ? "Hide" : "Order statuses"} ({statuses.join(", ") || "none"})
        </button>
        {showStatuses && (
          <div className="mt-2 flex flex-wrap gap-3 rounded-md border border-slate-200 bg-white p-3">
            {ALL_STATUSES.map((s) => (
              <label key={s} className="flex items-center gap-1.5 text-sm text-slate-600">
                <input
                  type="checkbox"
                  checked={statuses.includes(s)}
                  onChange={() => toggleStatus(s)}
                  className="h-4 w-4"
                />
                {s}
              </label>
            ))}
          </div>
        )}
      </div>

      {error && (
        <div className="mt-5 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}
      </div>

      {/* Results */}
      {result && (
        <div className="mx-auto mt-8 max-w-[1200px] space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-slate-800">Results — {result.rangeLabel}</h2>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => exportCsv(result.rows, `${exportBase}.csv`)}
                className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
              >
                Export CSV
              </button>
              <button
                type="button"
                onClick={() => exportXlsx(result.rows, `${exportBase}.xlsx`)}
                className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
              >
                Export XLSX
              </button>
            </div>
          </div>

          <AttributionSummary data={result} />
          <ResultsTable rows={result.rows} />

          {result.notFoundCount > 0 && (
            <p className="text-xs text-slate-400">
              {result.notFoundCount} customer{result.notFoundCount === 1 ? "" : "s"} not found in the
              month’s website orders — they likely ordered via phone, a rep, or another channel.
            </p>
          )}
        </div>
      )}
    </main>
  );
}

function Spinner() {
  return (
    <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-90" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.4 0 0 5.4 0 12h4z" />
    </svg>
  );
}
