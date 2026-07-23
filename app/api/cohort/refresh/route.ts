// Recompute every saved customer's website spend from live WooCommerce orders.
// Fetches all orders from the earliest acquisition date to today in one paginated
// sweep, then attributes them to saved customers by email / customer id.

import { NextResponse } from "next/server";
import { fetchOrders, getConfig, WooError } from "@/lib/woocommerce";
import { getCohort, saveSpendSnapshots, DbError } from "@/lib/db";
import { computeSnapshots, summarizeCohort, earliestAcqDate } from "@/lib/cohort";
import type { CohortResponse } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function POST() {
  let cohort;
  try {
    cohort = await getCohort();
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed to load cohort." }, { status: 500 });
  }

  if (cohort.length === 0) {
    const body: CohortResponse = { customers: [], summary: [], spendRefreshedAt: null };
    return NextResponse.json(body);
  }

  let cfg;
  try {
    cfg = getConfig();
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "WooCommerce not configured." }, { status: 500 });
  }

  const from = earliestAcqDate(cohort) ?? today();

  try {
    // Default statuses (processing + completed) = realised revenue.
    const { orders } = await fetchOrders(cfg, from, today(), []);
    const snaps = computeSnapshots(cohort, orders);
    await saveSpendSnapshots(snaps);

    const updated = await getCohort();
    const spendRefreshedAt = new Date().toISOString();
    const body: CohortResponse = { customers: updated, summary: summarizeCohort(updated), spendRefreshedAt };
    return NextResponse.json(body);
  } catch (err) {
    const status = err instanceof WooError && err.status ? err.status : err instanceof DbError ? 500 : 502;
    return NextResponse.json({ error: err instanceof Error ? err.message : "Refresh failed." }, { status });
  }
}
