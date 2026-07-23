"use client";

import type { AttributeResponse } from "@/lib/types";

export default function AttributionSummary({ data }: { data: AttributeResponse }) {
  const { summary, matchedCount, nameOnlyCount, notFoundCount, totalCustomers, ordersFetched, monthLabel } = data;

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold text-slate-800">Attribution summary</h2>
        <span className="text-xs text-slate-500">
          {monthLabel} · {ordersFetched} orders scanned
        </span>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Customers" value={totalCustomers} />
        <Stat label="Matched" value={matchedCount} tone="green" />
        <Stat label="Name-only" value={nameOnlyCount} tone="amber" />
        <Stat label="Not found" value={notFoundCount} tone="red" />
      </div>

      {summary.length === 0 ? (
        <p className="text-sm text-slate-500">No matched customers to summarise.</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {summary.map((line) => (
            <li key={line.label} className="flex items-center justify-between py-1.5 text-sm">
              <span className="text-slate-700">{line.label}</span>
              <span className="tabular-nums text-slate-500">
                <span className="font-medium text-slate-800">{line.count}</span> · {line.percent}%
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3 text-xs text-slate-400">
        Percentages are of matched customers ({matchedCount + nameOnlyCount}). “Not found” customers likely
        ordered via phone / rep / another channel and aren’t in the website orders.
      </p>
    </section>
  );
}

function Stat({
  label,
  value,
  tone = "slate",
}: {
  label: string;
  value: number;
  tone?: "slate" | "green" | "amber" | "red";
}) {
  const tones: Record<string, string> = {
    slate: "bg-slate-50 text-slate-700",
    green: "bg-green-50 text-green-700",
    amber: "bg-amber-50 text-amber-700",
    red: "bg-red-50 text-red-700",
  };
  return (
    <div className={`rounded-md px-3 py-2 ${tones[tone]}`}>
      <div className="text-lg font-semibold tabular-nums">{value}</div>
      <div className="text-xs opacity-80">{label}</div>
    </div>
  );
}
