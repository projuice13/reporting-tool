"use client";

import { useMemo, useState } from "react";
import type { AttributionRow } from "@/lib/types";

type SortKey = "company" | "postcode" | "status" | "acqOrderNumber" | "acqDate" | "attribution";
type SortDir = "asc" | "desc";

const STATUS_LABEL: Record<AttributionRow["status"], string> = {
  MATCHED: "Matched",
  NAME_ONLY: "Name-only",
  NOT_FOUND: "NOT FOUND",
};

export default function ResultsTable({ rows }: { rows: AttributionRow[] }) {
  const [filter, setFilter] = useState("");
  const [onlyUnmatched, setOnlyUnmatched] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("status");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    let out = rows.filter((r) => {
      if (onlyUnmatched && r.status !== "NOT_FOUND") return false;
      if (!q) return true;
      return (
        r.company.toLowerCase().includes(q) ||
        r.postcode.toLowerCase().includes(q) ||
        (r.attribution ?? "").toLowerCase().includes(q) ||
        (r.acqOrderNumber ?? "").toLowerCase().includes(q)
      );
    });

    out = [...out].sort((a, b) => {
      const av = (a[sortKey] ?? "") as string;
      const bv = (b[sortKey] ?? "") as string;
      const cmp = String(av).localeCompare(String(bv), undefined, { numeric: true });
      return sortDir === "asc" ? cmp : -cmp;
    });
    return out;
  }, [rows, filter, onlyUnmatched, sortKey, sortDir]);

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  return (
    <section className="rounded-lg border border-slate-200 bg-white">
      <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 p-3">
        <input
          type="text"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter by company, postcode, attribution…"
          className="min-w-0 flex-1 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-slate-400 focus:outline-none"
        />
        <label className="flex select-none items-center gap-2 text-sm text-slate-600">
          <input
            type="checkbox"
            checked={onlyUnmatched}
            onChange={(e) => setOnlyUnmatched(e.target.checked)}
            className="h-4 w-4"
          />
          Only unmatched
        </label>
        <span className="text-xs text-slate-400">
          {visible.length} of {rows.length}
        </span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <Th label="Company" k="company" {...{ sortKey, sortDir, toggleSort }} />
              <Th label="Postcode" k="postcode" {...{ sortKey, sortDir, toggleSort }} />
              <Th label="Status" k="status" {...{ sortKey, sortDir, toggleSort }} />
              <Th label="Acq. Order #" k="acqOrderNumber" {...{ sortKey, sortDir, toggleSort }} />
              <Th label="Date" k="acqDate" {...{ sortKey, sortDir, toggleSort }} />
              <Th label="Attribution" k="attribution" {...{ sortKey, sortDir, toggleSort }} />
              <th className="px-3 py-2 font-medium">All Orders</th>
              <th className="px-3 py-2 font-medium">Notes</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((r) => {
              const isNotFound = r.status === "NOT_FOUND";
              return (
                <tr
                  key={r.rowIndex}
                  className={`border-b border-slate-100 align-top ${
                    isNotFound ? "bg-yellow-200" : "hover:bg-slate-50"
                  }`}
                >
                  <td className="px-3 py-2 font-medium text-slate-800">{r.company}</td>
                  <td className="px-3 py-2 tabular-nums text-slate-600">{r.postcode || "—"}</td>
                  <td className="px-3 py-2">
                    <StatusPill status={r.status} />
                  </td>
                  <td className="px-3 py-2 tabular-nums text-slate-600">{r.acqOrderNumber ?? "—"}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-slate-600">{r.acqDate ?? "—"}</td>
                  <td className="px-3 py-2 text-slate-700">{r.attribution ?? "—"}</td>
                  <td className="px-3 py-2 text-slate-500">
                    {r.allOrders.length === 0 ? (
                      "—"
                    ) : (
                      <span className="whitespace-nowrap">
                        {r.allOrders.map((o, i) => (
                          <span key={o.number}>
                            {i > 0 && ", "}
                            <span title={`${o.attribution} · score ${o.score}`}>#{o.number}</span>
                          </span>
                        ))}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-xs text-slate-500">{r.notes}</td>
                </tr>
              );
            })}
            {visible.length === 0 && (
              <tr>
                <td colSpan={8} className="px-3 py-8 text-center text-slate-400">
                  No rows match the current filter.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Th({
  label,
  k,
  sortKey,
  sortDir,
  toggleSort,
}: {
  label: string;
  k: SortKey;
  sortKey: SortKey;
  sortDir: SortDir;
  toggleSort: (k: SortKey) => void;
}) {
  const active = sortKey === k;
  return (
    <th className="px-3 py-2 font-medium">
      <button
        type="button"
        onClick={() => toggleSort(k)}
        className="flex items-center gap-1 uppercase tracking-wide hover:text-slate-700"
      >
        {label}
        <span className="text-[10px]">{active ? (sortDir === "asc" ? "▲" : "▼") : "↕"}</span>
      </button>
    </th>
  );
}

function StatusPill({ status }: { status: AttributionRow["status"] }) {
  const styles: Record<AttributionRow["status"], string> = {
    MATCHED: "bg-green-100 text-green-800",
    NAME_ONLY: "bg-amber-100 text-amber-800",
    NOT_FOUND: "bg-red-100 text-red-800",
  };
  return (
    <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${styles[status]}`}>
      {STATUS_LABEL[status]}
    </span>
  );
}
