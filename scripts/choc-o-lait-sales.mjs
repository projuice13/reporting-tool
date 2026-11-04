#!/usr/bin/env node
// One-off sales report: total revenue for "Choc-O-Lait"-related products,
// by ProJuice financial year (1 Nov – 31 Oct), for the last N financial years.
//
// Reads the same WooCommerce credentials as the main app, from env vars:
//   WC_STORE_URL, WC_CONSUMER_KEY, WC_CONSUMER_SECRET
// Optional:
//   WC_ORDER_STATUSES   (default "processing,completed")
//
// Usage:
//   node scripts/choc-o-lait-sales.mjs              # last 3 financial years
//   node scripts/choc-o-lait-sales.mjs --years 5    # last 5
//   node scripts/choc-o-lait-sales.mjs --match "choc-o-lait" --match "chocolait"
//
// No dependencies — uses Node 18+ global fetch.

const PER_PAGE = 100;
const CONCURRENCY = 5;
const MAX_RETRIES = 3;

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
function args(name) {
  const out = [];
  process.argv.forEach((a, i) => {
    if (a === `--${name}` && process.argv[i + 1]) out.push(process.argv[i + 1]);
  });
  return out;
}

const STORE_URL = (process.env.WC_STORE_URL ?? "").replace(/\/+$/, "");
const KEY = process.env.WC_CONSUMER_KEY ?? "";
const SECRET = process.env.WC_CONSUMER_SECRET ?? "";
const STATUSES = (process.env.WC_ORDER_STATUSES ?? "processing,completed")
  .split(",").map((s) => s.trim()).filter(Boolean);

const YEARS = Math.max(1, parseInt(arg("years", "3"), 10) || 3);
const MATCH_TERMS = (args("match").length ? args("match") : ["choc-o-lait"]).map((t) => t.toLowerCase());

if (!STORE_URL || !KEY || !SECRET) {
  const missing = [
    !STORE_URL && "WC_STORE_URL",
    !KEY && "WC_CONSUMER_KEY",
    !SECRET && "WC_CONSUMER_SECRET",
  ].filter(Boolean);
  console.error(`Missing WooCommerce config: ${missing.join(", ")}.`);
  console.error("Set these in the environment's secrets, then run in a fresh session.");
  process.exit(1);
}

const AUTH = "Basic " + Buffer.from(`${KEY}:${SECRET}`).toString("base64");

/** Financial years ending 31 Oct, most recent completed first. */
function financialYears(n) {
  const now = new Date();
  // The FY that most recently ended: if we're on/after 1 Nov, the FY ending
  // 31 Oct of THIS year is complete; otherwise the one ending last year.
  let lastEndYear = now.getUTCMonth() >= 10 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
  const out = [];
  for (let i = 0; i < n; i++) {
    const endYear = lastEndYear - i;
    out.push({
      label: `FY${endYear}`, // labelled by the year it ends in
      from: `${endYear - 1}-11-01`,
      to: `${endYear}-10-31`,
    });
  }
  return out.reverse(); // chronological for display
}

function window(from, to) {
  const after = `${from}T00:00:00`;
  const end = new Date(`${to}T00:00:00Z`);
  const beforeDate = new Date(end.getTime() + 24 * 60 * 60 * 1000);
  const before = `${beforeDate.toISOString().slice(0, 10)}T00:00:00`;
  return { after, before };
}

async function fetchPage(params, page) {
  const url = new URL(`${STORE_URL}/wp-json/wc/v3/orders`);
  for (const [k, v] of Object.entries({ ...params, page: String(page) })) url.searchParams.set(k, v);
  let lastErr;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(url, { headers: { Authorization: AUTH, Accept: "application/json" }, cache: "no-store" });
      if (res.status === 401 || res.status === 403) {
        throw Object.assign(new Error("WooCommerce rejected the API credentials (401/403)."), { fatal: true });
      }
      if (res.status === 429 || res.status >= 500) throw new Error(`WooCommerce returned ${res.status} on page ${page}.`);
      if (!res.ok) throw Object.assign(new Error(`Request failed (${res.status}) on page ${page}.`), { fatal: true });
      const body = await res.json();
      return { res, body };
    } catch (err) {
      lastErr = err;
      if (err.fatal) throw err;
      if (attempt < MAX_RETRIES - 1) await new Promise((r) => setTimeout(r, 400 * 2 ** attempt));
    }
  }
  throw lastErr;
}

async function fetchOrders(from, to) {
  const { after, before } = window(from, to);
  const params = {
    after, before,
    status: STATUSES.join(","),
    per_page: String(PER_PAGE),
    orderby: "date",
    order: "asc",
    _fields: "id,number,date_created,currency,line_items",
  };
  const first = await fetchPage(params, 1);
  const totalPages = parseInt(first.res.headers.get("X-WP-TotalPages") ?? "1", 10) || 1;
  const orders = [...first.body];
  for (let start = 2; start <= totalPages; start += CONCURRENCY) {
    const batch = [];
    for (let p = start; p < start + CONCURRENCY && p <= totalPages; p++) batch.push(fetchPage(params, p));
    const results = await Promise.all(batch);
    for (const r of results) orders.push(...r.body);
  }
  return orders;
}

const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
const matches = (name) => { const s = String(name ?? "").toLowerCase(); return MATCH_TERMS.some((t) => s.includes(t)); };

async function run() {
  const fys = financialYears(YEARS);
  console.log(`\nChoc-O-Lait product sales — revenue by financial year (1 Nov – 31 Oct)`);
  console.log(`Store: ${STORE_URL}`);
  console.log(`Order statuses counted: ${STATUSES.join(", ")}`);
  console.log(`Matching product name contains: ${MATCH_TERMS.map((t) => `"${t}"`).join(" or ")}\n`);

  const rows = [];
  const productTally = new Map(); // product name -> { exTax, units }
  let currency = "";

  for (const fy of fys) {
    const orders = await fetchOrders(fy.from, fy.to);
    let exTax = 0, incTax = 0, units = 0, matchedOrders = 0;
    for (const o of orders) {
      if (o.currency && !currency) currency = o.currency;
      let hit = false;
      for (const li of o.line_items ?? []) {
        if (!matches(li.name)) continue;
        hit = true;
        const t = num(li.total);
        const tax = num(li.total_tax);
        exTax += t;
        incTax += t + tax;
        units += num(li.quantity);
        const key = String(li.name);
        const agg = productTally.get(key) ?? { exTax: 0, units: 0 };
        agg.exTax += t; agg.units += num(li.quantity);
        productTally.set(key, agg);
      }
      if (hit) matchedOrders++;
    }
    rows.push({ ...fy, orders: orders.length, matchedOrders, exTax, incTax, units });
  }

  const cur = currency || "GBP";
  const money = (v) => new Intl.NumberFormat("en-GB", { style: "currency", currency: cur }).format(v);

  console.log("Financial year   Revenue (ex tax)   Revenue (inc tax)   Units   Orders w/ item   Orders scanned");
  console.log("".padEnd(100, "-"));
  let tExT = 0, tIncT = 0, tUnits = 0;
  for (const r of rows) {
    tExT += r.exTax; tIncT += r.incTax; tUnits += r.units;
    console.log(
      `${(r.label + " (" + r.from + "→" + r.to + ")").padEnd(32)} ` +
      `${money(r.exTax).padStart(14)}   ${money(r.incTax).padStart(16)}   ` +
      `${String(r.units).padStart(5)}   ${String(r.matchedOrders).padStart(13)}   ${String(r.orders).padStart(13)}`
    );
  }
  console.log("".padEnd(100, "-"));
  console.log(`${"TOTAL (3 FY)".padEnd(32)} ${money(tExT).padStart(14)}   ${money(tIncT).padStart(16)}   ${String(tUnits).padStart(5)}`);

  console.log(`\nMatched products (ex-tax revenue, all years):`);
  const prods = [...productTally.entries()].sort((a, b) => b[1].exTax - a[1].exTax);
  if (prods.length === 0) {
    console.log("  (none — no line items matched; check the --match term against real product names)");
  } else {
    for (const [name, agg] of prods) console.log(`  ${money(agg.exTax).padStart(12)}  ${String(agg.units).padStart(5)}u  ${name}`);
  }
  console.log("");
}

run().catch((err) => {
  console.error(`\nReport failed: ${err.message}`);
  process.exit(1);
});
