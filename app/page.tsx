"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { parseCustomerCsv, CsvError, type ParseResult } from "@/lib/csv";
import { exportCsv, exportXlsx } from "@/lib/export";
import { ATTRIBUTION_PRESETS } from "@/lib/attribution";
import type { AttributeResponse, ConfirmCustomer } from "@/lib/types";
import AttributionSummary from "@/components/AttributionSummary";
import ResultsTable, { type RowEdit } from "@/components/ResultsTable";

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

  // Per-row attribution / email overrides, keyed by rowIndex.
  const [edits, setEdits] = useState<Record<number, RowEdit>>({});
  const [confirming, setConfirming] = useState(false);
  const [confirmMsg, setConfirmMsg] = useState<string>("");

  const fileInputRef = useRef<HTMLInputElement>(null);

  const rangeInvalid = !from || !to || from > to;

  function editRow(rowIndex: number, patch: RowEdit) {
    setEdits((cur) => ({ ...cur, [rowIndex]: { ...cur[rowIndex], ...patch } }));
    setConfirmMsg("");
  }

  const effectiveAttr = (rowIndex: number, detected?: string) =>
    (edits[rowIndex]?.attribution ?? detected ?? "").trim();

  const attrOptions = result
    ? Array.from(new Set([...ATTRIBUTION_PRESETS, ...result.rows.map((r) => r.attribution ?? "").filter(Boolean)]))
    : ATTRIBUTION_PRESETS;

  const unattributed = result
    ? result.rows.filter((r) => !effectiveAttr(r.rowIndex, r.attribution)).length
    : 0;

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
    setEdits({});
    setConfirmMsg("");
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

  async function confirmReport() {
    if (!result) return;
    setConfirming(true);
    setConfirmMsg("");
    setError("");

    const payload: ConfirmCustomer[] = [];
    let skipped = 0;
    for (const r of result.rows) {
      const attribution = effectiveAttr(r.rowIndex, r.attribution);
      if (!attribution) {
        skipped++;
        continue; // can't save without an attribution
      }
      const edited = edits[r.rowIndex]?.attribution?.trim();
      const isManual = r.status === "NOT_FOUND" || (!!edited && edited !== (r.attribution ?? ""));
      payload.push({
        company: r.company,
        postcode: r.postcode,
        email: edits[r.rowIndex]?.email?.trim() || r.acqEmail,
        wcCustomerId: r.acqCustomerId,
        attribution,
        attributionSource: isManual ? "manual" : "auto",
        acqOrderNumber: r.acqOrderNumber,
        acqDate: r.acqDateIso,
        acqTotal: r.acqTotal,
        statusAtConfirm: r.status,
      });
    }

    if (payload.length === 0) {
      setConfirmMsg("Nothing to save — every row needs an attribution first.");
      setConfirming(false);
      return;
    }

    try {
      const res = await fetch("/api/cohort/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customers: payload }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error ?? `Save failed (${res.status}).`);
        return;
      }
      setConfirmMsg(
        `Saved ${data.saved} customer${data.saved === 1 ? "" : "s"} to the cohort` +
          (skipped ? ` (${skipped} skipped — no attribution).` : ".")
      );
    } catch {
      setError("Network error saving the cohort.");
    } finally {
      setConfirming(false);
    }
  }

  const canRun = !!parsed && !loading && !rangeInvalid;
  const exportBase = `projuice-attribution-${from}_to_${to}`;

  return (
    <main className="px-4 py-10">
      <div className="mx-auto max-w-[720px]">
      <header className="mb-6">
        <div className="flex items-start justify-between gap-3">
          <h1 className="text-2xl font-bold text-slate-900">New Customer Attribution</h1>
          <Link
            href="/cohort"
            className="mt-1 whitespace-nowrap rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
          >
            Cohort dashboard →
          </Link>
        </div>
        <p className="mt-1 text-sm text-slate-500">
          Upload a new-customer CSV, pick a date range, and match each customer to their WooCommerce
          order to see how they were acquired — then confirm to track their spend over time.
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

          <p className="text-xs text-slate-500">
            Review each attribution below — edit any of them, and for <span className="font-medium">NOT FOUND</span>{" "}
            rows investigate and pick the source (add their email to track future spend). Then confirm to save this
            report into the cohort.
          </p>

          <ResultsTable rows={result.rows} edits={edits} onEdit={editRow} attrOptions={attrOptions} />

          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white p-3">
            <div className="text-sm text-slate-600">
              {unattributed > 0 ? (
                <span className="text-amber-700">
                  {unattributed} row{unattributed === 1 ? "" : "s"} still need an attribution before they can be saved.
                </span>
              ) : (
                <span>All rows have an attribution.</span>
              )}
              {confirmMsg && <span className="ml-2 font-medium text-green-700">{confirmMsg}</span>}
            </div>
            <div className="flex items-center gap-2">
              {confirmMsg && (
                <Link href="/cohort" className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">
                  View cohort →
                </Link>
              )}
              <button
                type="button"
                onClick={confirmReport}
                disabled={confirming}
                className="inline-flex items-center gap-2 rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {confirming ? (
                  <>
                    <Spinner /> Saving…
                  </>
                ) : (
                  "Confirm & save report"
                )}
              </button>
            </div>
          </div>

          {result.notFoundCount > 0 && (
            <p className="text-xs text-slate-400">
              {result.notFoundCount} customer{result.notFoundCount === 1 ? "" : "s"} not found in the website
              orders for this period — they likely ordered via phone, a rep, or another channel.
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
