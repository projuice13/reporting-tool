// Client-side export of the results table to CSV / XLSX.

import type { AttributionRow } from "./types";

const HEADERS = [
  "Company",
  "Postcode",
  "Amount",
  "Status",
  "Acq. Order #",
  "Date",
  "Attribution",
  "All Orders",
  "Notes",
] as const;

function rowToArray(r: AttributionRow): (string | number)[] {
  return [
    r.company,
    r.postcode,
    r.amount ?? "",
    r.status, // preserves the yellow flag as a "Status" column (NOT_FOUND)
    r.acqOrderNumber ?? "",
    r.acqDate ?? "",
    r.attribution ?? "",
    r.allOrders.map((o) => `#${o.number}`).join(" "),
    r.notes,
  ];
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function csvCell(v: string | number): string {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function exportCsv(rows: AttributionRow[], filename: string) {
  const lines = [HEADERS.join(",")];
  for (const r of rows) lines.push(rowToArray(r).map(csvCell).join(","));
  // Prepend BOM so Excel opens UTF-8 cleanly.
  const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8;" });
  triggerDownload(blob, filename);
}

export async function exportXlsx(rows: AttributionRow[], filename: string) {
  const XLSX = await import("xlsx");
  const aoa = [HEADERS as unknown as string[], ...rows.map(rowToArray)];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Attribution");
  XLSX.writeFile(wb, filename);
}
