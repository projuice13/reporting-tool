"use client";

import { useMemo, useRef, useState } from "react";
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

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function previousMonth(): { year: number; month: number } {
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  return { year: d.getFullYear(), month: d.getMonth() + 1 };
}

export default function Home() {
  const prev = previousMonth();
  const [parsed, setParsed] = useState<ParseResult | null>(null);
  const [fileName, setFileName] = useState<string>("");
  const [year, setYear] = useState<number>(prev.year);
  const [month, setMonth] = useState<number>(prev.month);
  const [statuses, setStatuses] = useState<string[]>(["processing", "completed"]);
  const [showStatuses, setShowStatuses] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>("");
  const [result, setResult] = useState<AttributeResponse | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const years = useMemo(() => {
    const y = new Date().getFullYear();
    return [y + 1, y, y - 1, y - 2, y - 3];
  }, []);

  const monthLabel = `${MONTHS[month - 1]} ${year}`;

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
        body: JSON.stringify({ customers: parsed.customers, year, month, statuses }),
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

  const canRun = !!parsed && !loading;
  const exportBase = `projuice-attribution-${year}-${String(month).padStart(2, "0")}`;

  return (
    <main className="mx-auto max-w-[720px] px-4 py-10">
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

      {/* Month + status controls */}
      <div className="mt-5 flex flex-wrap items-end gap-3">
        <label className="text-sm">
          <span className="mb-1 block text-slate-600">Month</span>
          <select
            value={month}
            onChange={(e) => setMonth(Number(e.target.value))}
            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-slate-900"
          >
            {MONTHS.map((m, i) => (
              <option key={m} value={i + 1}>
                {m}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-slate-600">Year</span>
          <select
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-slate-900"
          >
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </label>

        <button
          type="button"
          onClick={run}
          disabled={!canRun}
          className="ml-auto inline-flex items-center gap-2 rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {loading ? (
            <>
              <Spinner /> Fetching {MONTHS[month - 1]} orders…
            </>
          ) : (
            "Run attribution"
          )}
        </button>
      </div>

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

      {/* Results */}
      {result && (
        <div className="mt-8 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-slate-800">Results — {monthLabel}</h2>
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
