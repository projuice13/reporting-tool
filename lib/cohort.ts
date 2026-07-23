// Pure cohort spend maths: turn saved customers + their WooCommerce orders into
// per-customer spend snapshots, and roll a cohort up by attribution source.

import type { CohortCustomer, CohortSourceSummary, OrderLite } from "./types";
import type { SpendSnapshot } from "./db";

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const DAYS_PER_MONTH = 30.436875;

function parseMoney(v: string): number {
  const n = parseFloat(String(v).replace(/[^0-9.-]/g, ""));
  return isNaN(n) ? 0 : n;
}

function toDate(s: string | null | undefined): Date | null {
  if (!s) return null;
  const d = new Date(s.length <= 10 ? `${s}T00:00:00Z` : s);
  return isNaN(d.getTime()) ? null : d;
}

function addMonths(d: Date, n: number): Date {
  const x = new Date(d);
  x.setUTCMonth(x.getUTCMonth() + n);
  return x;
}

/** Whole completed months between two dates. */
function wholeMonths(a: Date, b: Date): number {
  let m = (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth());
  if (b.getUTCDate() < a.getUTCDate()) m -= 1;
  return Math.max(0, m);
}

/**
 * Compute spend snapshots for customers that have a website identity
 * (email or WooCommerce customer id). Customers without one are skipped
 * (they stay unsnapshotted — no way to track their website spend).
 */
export function computeSnapshots(
  customers: CohortCustomer[],
  orders: OrderLite[],
  now: Date = new Date()
): SpendSnapshot[] {
  // Index orders by lowercased email and by customer id.
  const byEmail = new Map<string, OrderLite[]>();
  const byCustomer = new Map<number, OrderLite[]>();
  for (const o of orders) {
    const email = o.billing.email.trim().toLowerCase();
    if (email) {
      if (!byEmail.has(email)) byEmail.set(email, []);
      byEmail.get(email)!.push(o);
    }
    if (o.customerId > 0) {
      if (!byCustomer.has(o.customerId)) byCustomer.set(o.customerId, []);
      byCustomer.get(o.customerId)!.push(o);
    }
  }

  const snaps: SpendSnapshot[] = [];
  for (const c of customers) {
    const email = (c.email ?? "").trim().toLowerCase();
    if (!email && !c.wcCustomerId) continue; // no identity → can't track

    // Gather this customer's orders from both indexes, deduped by order id.
    const mine = new Map<number, OrderLite>();
    if (email) for (const o of byEmail.get(email) ?? []) mine.set(o.id, o);
    if (c.wcCustomerId) for (const o of byCustomer.get(c.wcCustomerId) ?? []) mine.set(o.id, o);
    const list = [...mine.values()];

    const acq = toDate(c.acqDate) ?? list.map((o) => toDate(o.dateCreated)).filter(Boolean).sort((a, b) => a!.getTime() - b!.getTime())[0] ?? null;

    let totalSpend = 0;
    let lastOrder: Date | null = null;
    let s6 = 0, s12 = 0, s18 = 0;
    const b6 = acq ? addMonths(acq, 6) : null;
    const b12 = acq ? addMonths(acq, 12) : null;
    const b18 = acq ? addMonths(acq, 18) : null;

    for (const o of list) {
      const d = toDate(o.dateCreated);
      const amt = parseMoney(o.total);
      totalSpend += amt;
      if (d && (!lastOrder || d > lastOrder)) lastOrder = d;
      if (d && b6 && d <= b6) s6 += amt;
      if (d && b12 && d <= b12) s12 += amt;
      if (d && b18 && d <= b18) s18 += amt;
    }

    const monthsTracked = acq ? wholeMonths(acq, now) : 0;
    const fractionalMonths = acq ? Math.max(1, (now.getTime() - acq.getTime()) / MS_PER_DAY / DAYS_PER_MONTH) : 1;
    const round = (n: number) => Math.round(n * 100) / 100;

    snaps.push({
      id: c.id,
      totalSpend: round(totalSpend),
      orderCount: list.length,
      lastOrderDate: lastOrder ? lastOrder.toISOString().slice(0, 10) : null,
      spend6m: round(s6),
      spend12m: round(s12),
      spend18m: round(s18),
      avgMonthlySpend: round(totalSpend / fractionalMonths),
      monthsTracked,
    });
  }
  return snaps;
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const round2 = (n: number) => Math.round(n * 100) / 100;

/** Roll the saved cohort up by attribution source. */
export function summarizeCohort(customers: CohortCustomer[]): CohortSourceSummary[] {
  const groups = new Map<string, CohortCustomer[]>();
  for (const c of customers) {
    const key = c.attribution || "Unknown";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(c);
  }

  const out: CohortSourceSummary[] = [];
  for (const [attribution, list] of groups) {
    // Tenure-mature subsets — only average a window over customers old enough
    // to have a full window of spend, so the averages aren't diluted.
    const m6 = list.filter((c) => (c.monthsTracked ?? 0) >= 6);
    const m12 = list.filter((c) => (c.monthsTracked ?? 0) >= 12);
    const m18 = list.filter((c) => (c.monthsTracked ?? 0) >= 18);
    const tracked = list.filter((c) => c.monthsTracked != null);

    out.push({
      attribution,
      customers: list.length,
      totalAcqValue: round2(list.reduce((s, c) => s + (c.acqTotal ?? 0), 0)),
      totalSpend: round2(list.reduce((s, c) => s + (c.totalSpend ?? 0), 0)),
      avgMonthlySpend: round2(mean(tracked.map((c) => c.avgMonthlySpend ?? 0))),
      avg6m: round2(mean(m6.map((c) => c.spend6m ?? 0))),
      avg12m: round2(mean(m12.map((c) => c.spend12m ?? 0))),
      avg18m: round2(mean(m18.map((c) => c.spend18m ?? 0))),
      mature6m: m6.length,
      mature12m: m12.length,
      mature18m: m18.length,
    });
  }
  return out.sort((a, b) => b.customers - a.customers);
}

/** Earliest acquisition date across the cohort, as YYYY-MM-DD (or null). */
export function earliestAcqDate(customers: CohortCustomer[]): string | null {
  let min: string | null = null;
  for (const c of customers) {
    if (c.acqDate && (!min || c.acqDate < min)) min = c.acqDate;
  }
  return min;
}
