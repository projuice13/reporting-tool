// WooCommerce REST API integration: auth, paginated order fetch, meta
// extraction and origin resolution. Server-side only — reads credentials from
// environment variables that must never reach the browser.

import type { OrderAttribution, OrderLite } from "./types";

const PER_PAGE = 100; // API max
const CONCURRENCY = 5; // pages fetched in parallel per batch
const MAX_RETRIES = 3;

export class WooError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "WooError";
    this.status = status;
  }
}

interface WooConfig {
  storeUrl: string;
  authHeader: string;
  defaultStatuses: string[];
}

/** Read + validate env config. Throws a clear WooError if misconfigured. */
export function getConfig(): WooConfig {
  const storeUrl = (process.env.WC_STORE_URL ?? "").replace(/\/+$/, "");
  const key = process.env.WC_CONSUMER_KEY ?? "";
  const secret = process.env.WC_CONSUMER_SECRET ?? "";
  const defaultStatuses = (process.env.WC_ORDER_STATUSES ?? "processing,completed")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const missing: string[] = [];
  if (!storeUrl) missing.push("WC_STORE_URL");
  if (!key) missing.push("WC_CONSUMER_KEY");
  if (!secret) missing.push("WC_CONSUMER_SECRET");
  if (missing.length) {
    throw new WooError(
      `Server is missing WooCommerce configuration: ${missing.join(", ")}. ` +
        `Set these environment variables (see .env.example).`
    );
  }

  const authHeader = "Basic " + Buffer.from(`${key}:${secret}`).toString("base64");
  return { storeUrl, authHeader, defaultStatuses };
}

// ---------------------------------------------------------------------------
// Date window
// ---------------------------------------------------------------------------

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function fmtDay(ymd: string): string {
  return new Date(`${ymd}T00:00:00Z`).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

/**
 * Build the [after, before) window for an inclusive [from, to] date range
 * (both YYYY-MM-DD). `before` is the day *after* `to`, so the `to` day is
 * included. Boundaries are emitted without a timezone offset, so the
 * WooCommerce API treats them as GMT — a possible 1-hour edge effect around
 * midnight on the first/last day is immaterial for this reporting (brief §6).
 */
export function dateWindow(from: string, to: string): { after: string; before: string; label: string } {
  if (!DATE_RE.test(from) || !DATE_RE.test(to)) {
    throw new WooError("Dates must be in YYYY-MM-DD format.");
  }
  const start = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  if (isNaN(start.getTime()) || isNaN(end.getTime())) {
    throw new WooError("Invalid from/to date.");
  }
  if (start.getTime() > end.getTime()) {
    throw new WooError("The 'from' date must be on or before the 'to' date.");
  }

  const after = `${from}T00:00:00`;
  // Exclusive upper bound = to + 1 day, so the whole `to` day is included.
  const beforeDate = new Date(end.getTime() + 24 * 60 * 60 * 1000);
  const before = `${beforeDate.toISOString().slice(0, 10)}T00:00:00`;

  const label = from === to ? fmtDay(from) : `${fmtDay(from)} – ${fmtDay(to)}`;
  return { after, before, label };
}

// ---------------------------------------------------------------------------
// Fetching
// ---------------------------------------------------------------------------

function buildUrl(cfg: WooConfig, params: Record<string, string>): string {
  const url = new URL(`${cfg.storeUrl}/wp-json/wc/v3/orders`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return url.toString();
}

async function fetchPage(
  cfg: WooConfig,
  params: Record<string, string>,
  page: number
): Promise<{ res: Response; body: unknown[] }> {
  const url = buildUrl(cfg, { ...params, page: String(page) });
  let lastErr: unknown;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { Authorization: cfg.authHeader, Accept: "application/json" },
        cache: "no-store",
      });

      if (res.status === 401 || res.status === 403) {
        throw new WooError(
          "WooCommerce rejected the API credentials (401/403). Check WC_CONSUMER_KEY / WC_CONSUMER_SECRET.",
          res.status
        );
      }
      // Retry transient server / rate-limit errors.
      if (res.status === 429 || res.status >= 500) {
        throw new WooError(`WooCommerce returned ${res.status} on page ${page}.`, res.status);
      }
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new WooError(
          `WooCommerce request failed (${res.status}) on page ${page}. ${text.slice(0, 200)}`,
          res.status
        );
      }

      const body = (await res.json()) as unknown[];
      return { res, body };
    } catch (err) {
      lastErr = err;
      // Don't retry hard auth failures.
      if (err instanceof WooError && (err.status === 401 || err.status === 403)) throw err;
      if (attempt < MAX_RETRIES - 1) {
        await new Promise((r) => setTimeout(r, 400 * Math.pow(2, attempt)));
      }
    }
  }
  if (lastErr instanceof Error) throw lastErr;
  throw new WooError(`Failed to fetch page ${page} after ${MAX_RETRIES} attempts.`);
}

/** Fetch every matching order in the date range, across all pages. */
export async function fetchOrders(
  cfg: WooConfig,
  from: string,
  to: string,
  statuses: string[]
): Promise<{ orders: OrderLite[]; window: ReturnType<typeof dateWindow> }> {
  const window = dateWindow(from, to);
  const statusList = (statuses.length ? statuses : cfg.defaultStatuses).join(",");

  const baseParams: Record<string, string> = {
    after: window.after,
    before: window.before,
    status: statusList,
    per_page: String(PER_PAGE),
    orderby: "date",
    order: "asc",
  };

  // First page tells us how many pages there are.
  const first = await fetchPage(cfg, baseParams, 1);
  const totalPages = parseInt(first.res.headers.get("X-WP-TotalPages") ?? "1", 10) || 1;

  const raw: unknown[] = [...first.body];

  // Remaining pages, fetched in small concurrent batches to stay within the
  // serverless function timeout without hammering the store.
  for (let start = 2; start <= totalPages; start += CONCURRENCY) {
    const batch: Promise<{ body: unknown[] }>[] = [];
    for (let page = start; page < start + CONCURRENCY && page <= totalPages; page++) {
      batch.push(fetchPage(cfg, baseParams, page));
    }
    const results = await Promise.all(batch);
    for (const r of results) raw.push(...r.body);
  }

  const orders = raw.map(mapOrder);
  return { orders, window };
}

// ---------------------------------------------------------------------------
// Mapping + attribution resolution
// ---------------------------------------------------------------------------

interface RawMeta {
  key?: string;
  value?: unknown;
}

function metaMap(meta: RawMeta[] | undefined): Map<string, string> {
  const m = new Map<string, string>();
  if (!Array.isArray(meta)) return m;
  for (const entry of meta) {
    if (entry && typeof entry.key === "string") {
      m.set(entry.key, entry.value == null ? "" : String(entry.value));
    }
  }
  return m;
}

function titleCase(s: string): string {
  return s
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/**
 * Resolve the friendly origin. Prefer the store's own
 * `_wc_order_attribution_origin` verbatim; otherwise derive from source type.
 */
export function resolveOrigin(meta: Map<string, string>): OrderAttribution {
  const origin = meta.get("_wc_order_attribution_origin")?.trim();
  const sourceType = meta.get("_wc_order_attribution_source_type")?.trim();
  const utmSource = meta.get("_wc_order_attribution_utm_source")?.trim();
  const utmMedium = meta.get("_wc_order_attribution_utm_medium")?.trim();
  const utmCampaign = meta.get("_wc_order_attribution_utm_campaign")?.trim();
  const referrer = meta.get("_wc_order_attribution_referrer")?.trim();
  const deviceType = meta.get("_wc_order_attribution_device_type")?.trim();

  const base: OrderAttribution = {
    origin: "",
    sourceType,
    utmSource,
    utmMedium,
    utmCampaign,
    referrer,
    deviceType,
  };

  if (origin) {
    return { ...base, origin };
  }

  // No attribution meta at all → the feature wasn't enabled when this order
  // was placed.
  if (!sourceType && !utmSource && !referrer) {
    return { ...base, origin: "Unknown / not tracked" };
  }

  switch (sourceType) {
    case "typein":
    case "":
    case undefined:
      return { ...base, origin: "Direct" };
    case "organic":
      return { ...base, origin: `Organic: ${titleCase(utmSource ?? "")}`.trim() };
    case "utm":
      return { ...base, origin: `Source: ${titleCase(utmSource ?? "")}`.trim() };
    case "referral":
      return { ...base, origin: `Referral: ${referrer ? hostnameOf(referrer) : "unknown"}` };
    case "admin":
      return { ...base, origin: "Web admin" };
    default:
      return { ...base, origin: "Unknown" };
  }
}

function str(v: unknown): string {
  return v == null ? "" : String(v);
}

function mapOrder(raw: unknown): OrderLite {
  const o = raw as Record<string, any>;
  const billing = o.billing ?? {};
  const shipping = o.shipping ?? {};
  const attribution = resolveOrigin(metaMap(o.meta_data));

  return {
    id: Number(o.id),
    number: str(o.number ?? o.id),
    dateCreated: str(o.date_created ?? o.date_created_gmt),
    billing: {
      company: str(billing.company),
      postcode: str(billing.postcode),
      firstName: str(billing.first_name),
      lastName: str(billing.last_name),
      email: str(billing.email),
    },
    shipping: {
      company: str(shipping.company),
      postcode: str(shipping.postcode),
      firstName: str(shipping.first_name),
      lastName: str(shipping.last_name),
    },
    total: str(o.total),
    attribution,
  };
}
