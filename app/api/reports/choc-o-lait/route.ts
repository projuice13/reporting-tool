// Server route: total the revenue of products whose name matches given terms
// (default "choc-o-lait"), for a single date window. All WooCommerce
// credentials stay server-side (read from the same env vars as the rest of the
// app, which on Vercel are already configured).
//
// Unlike /api/attribute, this fetches each order's `line_items` so it can sum
// product-level sales — which is heavy, so callers should request one window
// (e.g. one financial year) at a time.
//
//   GET /api/reports/choc-o-lait?from=2023-11-01&to=2024-10-31
//       &match=choc-o-lait&statuses=processing,completed
//
// Returns JSON totals for that window (ex-tax + inc-tax revenue, units, and a
// per-product breakdown). Protected by the site login gate like every route.

import { NextResponse } from "next/server";
import { getConfig, dateWindow, WooError } from "@/lib/woocommerce";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

const PER_PAGE = 100;
const CONCURRENCY = 5;
const MAX_RETRIES = 3;

interface WooConfig {
  storeUrl: string;
  authHeader: string;
  defaultStatuses: string[];
}

async function fetchPage(cfg: WooConfig, params: Record<string, string>, page: number) {
  const url = new URL(`${cfg.storeUrl}/wp-json/wc/v3/orders`);
  for (const [k, v] of Object.entries({ ...params, page: String(page) })) url.searchParams.set(k, v);

  let lastErr: unknown;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(url.toString(), {
        headers: { Authorization: cfg.authHeader, Accept: "application/json" },
        cache: "no-store",
      });
      if (res.status === 401 || res.status === 403) {
        throw new WooError("WooCommerce rejected the API credentials (401/403).", res.status);
      }
      if (res.status === 429 || res.status >= 500) {
        throw new WooError(`WooCommerce returned ${res.status} on page ${page}.`, res.status);
      }
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new WooError(`WooCommerce request failed (${res.status}) on page ${page}. ${text.slice(0, 200)}`, res.status);
      }
      const body = (await res.json()) as unknown[];
      return { res, body };
    } catch (err) {
      lastErr = err;
      if (err instanceof WooError && (err.status === 401 || err.status === 403)) throw err;
      if (attempt < MAX_RETRIES - 1) await new Promise((r) => setTimeout(r, 400 * 2 ** attempt));
    }
  }
  if (lastErr instanceof Error) throw lastErr;
  throw new WooError(`Failed to fetch page ${page} after ${MAX_RETRIES} attempts.`);
}

const num = (v: unknown): number => {
  const n = parseFloat(String(v ?? ""));
  return Number.isFinite(n) ? n : 0;
};

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const from = url.searchParams.get("from") ?? "";
    const to = url.searchParams.get("to") ?? "";
    if (!from || !to) {
      return NextResponse.json({ error: "Provide `from` and `to` as YYYY-MM-DD." }, { status: 400 });
    }

    const terms = (url.searchParams.getAll("match").length
      ? url.searchParams.getAll("match")
      : ["choc-o-lait"]
    ).map((t) => t.trim().toLowerCase()).filter(Boolean);
    const matchesName = (name: unknown) => {
      const s = String(name ?? "").toLowerCase();
      return terms.some((t) => s.includes(t));
    };

    const cfg = getConfig();
    const statusesParam = url.searchParams.get("statuses");
    const statuses = statusesParam
      ? statusesParam.split(",").map((s) => s.trim()).filter(Boolean)
      : cfg.defaultStatuses;

    const win = dateWindow(from, to);
    const params: Record<string, string> = {
      after: win.after,
      before: win.before,
      status: statuses.join(","),
      per_page: String(PER_PAGE),
      orderby: "date",
      order: "asc",
      _fields: "id,number,date_created,currency,line_items",
    };

    const first = await fetchPage(cfg, params, 1);
    const totalPages = parseInt(first.res.headers.get("X-WP-TotalPages") ?? "1", 10) || 1;
    const raw: any[] = [...(first.body as any[])];
    for (let start = 2; start <= totalPages; start += CONCURRENCY) {
      const batch: Promise<{ body: unknown[] }>[] = [];
      for (let p = start; p < start + CONCURRENCY && p <= totalPages; p++) batch.push(fetchPage(cfg, params, p));
      const results = await Promise.all(batch);
      for (const r of results) raw.push(...(r.body as any[]));
    }

    let exTax = 0, incTax = 0, units = 0, matchedOrders = 0, currency = "";
    const products = new Map<string, { exTax: number; incTax: number; units: number }>();

    for (const o of raw) {
      if (o.currency && !currency) currency = String(o.currency);
      let hit = false;
      for (const li of o.line_items ?? []) {
        if (!matchesName(li.name)) continue;
        hit = true;
        const t = num(li.total);
        const tax = num(li.total_tax);
        const q = num(li.quantity);
        exTax += t;
        incTax += t + tax;
        units += q;
        const key = String(li.name);
        const agg = products.get(key) ?? { exTax: 0, incTax: 0, units: 0 };
        agg.exTax += t;
        agg.incTax += t + tax;
        agg.units += q;
        products.set(key, agg);
      }
      if (hit) matchedOrders++;
    }

    const round = (n: number) => Math.round(n * 100) / 100;
    return NextResponse.json({
      from,
      to,
      label: win.label,
      currency: currency || "GBP",
      statuses,
      match: terms,
      ordersScanned: raw.length,
      matchedOrders,
      units,
      revenueExTax: round(exTax),
      revenueIncTax: round(incTax),
      products: [...products.entries()]
        .map(([name, a]) => ({ name, units: a.units, revenueExTax: round(a.exTax), revenueIncTax: round(a.incTax) }))
        .sort((a, b) => b.revenueExTax - a.revenueExTax),
    });
  } catch (err) {
    const status = err instanceof WooError ? err.status ?? 500 : 500;
    const message = err instanceof Error ? err.message : "Unexpected error building the report.";
    return NextResponse.json({ error: message }, { status });
  }
}
