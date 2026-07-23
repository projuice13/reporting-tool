// Client-side attribution summary, derived from the currently-visible rows and
// their effective (possibly edited) attribution. Keeping this on the client
// means the summary stays correct when rows are re-attributed or removed.

import type { AttributionRow, SummaryLine } from "./types";

export interface SummaryData {
  summary: SummaryLine[];
  totalCustomers: number;
  matchedCount: number;
  nameOnlyCount: number;
  notFoundCount: number;
}

export function computeSummary(
  rows: AttributionRow[],
  getAttr: (r: AttributionRow) => string
): SummaryData {
  let matched = 0;
  let nameOnly = 0;
  let notFound = 0;
  const buckets = new Map<string, { count: number; value: number }>();

  for (const r of rows) {
    if (r.status === "NOT_FOUND") {
      notFound++;
      continue; // not-found rows aren't in any attribution bucket
    }
    if (r.status === "MATCHED") matched++;
    else nameOnly++;

    const label = getAttr(r) || "Unknown";
    const b = buckets.get(label) ?? { count: 0, value: 0 };
    b.count += 1;
    b.value += r.acqTotal ?? 0; // first order only
    buckets.set(label, b);
  }

  const totalMatched = matched + nameOnly || 1;
  const summary: SummaryLine[] = [...buckets.entries()]
    .map(([label, b]) => ({
      label,
      count: b.count,
      value: Math.round(b.value * 100) / 100,
      percent: Math.round((b.count / totalMatched) * 1000) / 10,
    }))
    .sort((a, b) => b.count - a.count);

  return {
    summary,
    totalCustomers: rows.length,
    matchedCount: matched,
    nameOnlyCount: nameOnly,
    notFoundCount: notFound,
  };
}
