// Server route: fetch the month's WooCommerce orders, match the uploaded
// customers, and return the results. All WooCommerce credentials stay here —
// the client only sends the parsed customer list + chosen month.

import { NextResponse } from "next/server";
import { fetchOrders, getConfig, WooError } from "@/lib/woocommerce";
import { matchCustomers } from "@/lib/match";
import type {
  AttributeRequest,
  AttributeResponse,
  AttributionRow,
  SummaryLine,
} from "@/lib/types";

// This route talks to an external API and can run for a while on big months.
export const runtime = "nodejs";
export const maxDuration = 60;

function buildSummary(rows: AttributionRow[]): SummaryLine[] {
  const matched = rows.filter((r) => r.status !== "NOT_FOUND");
  const counts = new Map<string, number>();
  for (const r of matched) {
    const label = r.attribution || "Unknown";
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  const total = matched.length || 1;
  const lines: SummaryLine[] = [...counts.entries()]
    .map(([label, count]) => ({
      label,
      count,
      percent: Math.round((count / total) * 1000) / 10,
    }))
    .sort((a, b) => b.count - a.count);
  return lines;
}

export async function POST(request: Request) {
  let payload: AttributeRequest;
  try {
    payload = (await request.json()) as AttributeRequest;
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const { customers, year, month, statuses } = payload ?? {};
  if (!Array.isArray(customers) || customers.length === 0) {
    return NextResponse.json({ error: "No customers provided." }, { status: 400 });
  }
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    return NextResponse.json({ error: "A valid month and year are required." }, { status: 400 });
  }

  let cfg;
  try {
    cfg = getConfig();
  } catch (err) {
    const message = err instanceof Error ? err.message : "Server misconfiguration.";
    return NextResponse.json({ error: message }, { status: 500 });
  }

  try {
    const { orders, window } = await fetchOrders(
      cfg,
      year,
      month,
      Array.isArray(statuses) ? statuses : []
    );

    const rows = matchCustomers(customers, orders);

    const matchedCount = rows.filter((r) => r.status === "MATCHED").length;
    const nameOnlyCount = rows.filter((r) => r.status === "NAME_ONLY").length;
    const notFoundCount = rows.filter((r) => r.status === "NOT_FOUND").length;

    const body: AttributeResponse = {
      rows,
      summary: buildSummary(rows),
      totalCustomers: rows.length,
      matchedCount,
      nameOnlyCount,
      notFoundCount,
      ordersFetched: orders.length,
      monthLabel: window.label,
      timezoneNote:
        "Order dates are filtered as GMT; a possible 1-hour edge effect on the first/last day is immaterial for month-level attribution.",
    };

    return NextResponse.json(body);
  } catch (err) {
    const status = err instanceof WooError && err.status ? err.status : 502;
    const message = err instanceof Error ? err.message : "Failed to fetch WooCommerce orders.";
    return NextResponse.json({ error: message }, { status });
  }
}
