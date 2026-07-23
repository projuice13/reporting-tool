// Core matching logic: normalisation, similarity, matching, collision resolution.
// This module is pure (no I/O) so it can be reasoned about and unit-tested.

import type {
  AttributionRow,
  MatchedOrderRef,
  NewCustomer,
  OrderLite,
} from "./types";

// ---------------------------------------------------------------------------
// Normalisation
// ---------------------------------------------------------------------------

const COMPANY_SUFFIXES = new Set([
  "ltd",
  "limited",
  "llp",
  "plc",
  "co",
  "company",
  "inc",
  "the",
]);

/** lowercase -> strip punctuation -> drop company suffixes -> collapse whitespace. */
export function normalizeCompany(input: string): string {
  if (!input) return "";
  const cleaned = input
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ") // strip punctuation
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return "";
  const tokens = cleaned
    .split(" ")
    .filter((t) => t.length > 0 && !COMPANY_SUFFIXES.has(t));
  // If removing suffixes emptied the string (e.g. "The Co"), fall back to cleaned.
  return (tokens.length ? tokens.join(" ") : cleaned).trim();
}

/** uppercase -> remove all non-alphanumerics. */
export function normalizePostcode(input: string): string {
  if (!input) return "";
  return input.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

// ---------------------------------------------------------------------------
// Similarity
// ---------------------------------------------------------------------------

/** Classic Levenshtein edit distance. */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  let prev = new Array(b.length + 1);
  let curr = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    const ac = a.charCodeAt(i - 1);
    for (let j = 1; j <= b.length; j++) {
      const cost = ac === b.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(
        prev[j] + 1, // deletion
        curr[j - 1] + 1, // insertion
        prev[j - 1] + cost // substitution
      );
    }
    [prev, curr] = [curr, prev];
  }
  return prev[b.length];
}

/** Simple 0-100 similarity ratio from edit distance. */
function ratio(a: string, b: string): number {
  if (!a.length && !b.length) return 100;
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 100;
  return (1 - levenshtein(a, b) / maxLen) * 100;
}

/** Token-sort ratio: sort whitespace tokens before comparing. */
function tokenSortRatio(a: string, b: string): number {
  const sort = (s: string) => s.split(/\s+/).filter(Boolean).sort().join(" ");
  return ratio(sort(a), sort(b));
}

/**
 * Partial ratio: best ratio of the shorter string against every substring
 * of the same length in the longer string. Rewards "Franzo" vs
 * "Franzos - Coventry".
 */
function partialRatio(a: string, b: string): number {
  if (!a.length || !b.length) return a.length === b.length ? 100 : 0;
  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
  const win = shorter.length;
  let best = 0;
  for (let i = 0; i + win <= longer.length; i++) {
    const sub = longer.slice(i, i + win);
    const r = ratio(shorter, sub);
    if (r > best) best = r;
    if (best === 100) break;
  }
  return best;
}

/** max(tokenSort, partial), 0-100, robust to spacing differences. */
export function similarity(a: string, b: string): number {
  if (!a || !b) return 0;
  let best = Math.max(tokenSortRatio(a, b), partialRatio(a, b));

  // Also compare with all whitespace removed, so spacing-only variants such as
  // "Bio Reliance" vs "BioReliance" (or "Mooka Gelato" vs "MookaGelato") score
  // as near-identical. The partial pass is length-guarded so a very short
  // customer name can't trivially match as a substring of a longer order name.
  const da = a.replace(/\s+/g, "");
  const db = b.replace(/\s+/g, "");
  if (da && db) {
    best = Math.max(best, ratio(da, db));
    if (Math.min(da.length, db.length) >= 5) {
      best = Math.max(best, partialRatio(da, db));
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------

const POSTCODE_THRESHOLD = 85; // with a postcode match
const NAME_ONLY_THRESHOLD = 93; // no postcode

interface OrderCandidate {
  norm: string; // normalised candidate field value
  postcode: string; // normalised postcode this candidate belongs to
}

/** Pre-compute the normalised match fields for an order. */
interface PreppedOrder {
  order: OrderLite;
  billingPostcode: string;
  shippingPostcode: string;
  candidates: OrderCandidate[]; // billing company, shipping company, billing name, shipping name
}

function prepOrder(order: OrderLite): PreppedOrder {
  const bPost = normalizePostcode(order.billing.postcode);
  const sPost = normalizePostcode(order.shipping.postcode);
  const billingName = `${order.billing.firstName} ${order.billing.lastName}`.trim();
  const shippingName = `${order.shipping.firstName} ${order.shipping.lastName}`.trim();

  const candidates: OrderCandidate[] = [];
  if (order.billing.company) candidates.push({ norm: normalizeCompany(order.billing.company), postcode: bPost });
  if (order.shipping.company) candidates.push({ norm: normalizeCompany(order.shipping.company), postcode: sPost });
  if (billingName) candidates.push({ norm: normalizeCompany(billingName), postcode: bPost });
  if (shippingName) candidates.push({ norm: normalizeCompany(shippingName), postcode: sPost });

  return { order, billingPostcode: bPost, shippingPostcode: sPost, candidates };
}

type ClaimKind = "postcode" | "postcode-mismatch" | "name-only";

/** A single (customer, order) claim produced by the scoring pass. */
interface Claim {
  customerIndex: number;
  order: OrderLite;
  score: number;
  exact: boolean;
  /** True when the match needs human eyeballs (no postcode confirmation). */
  nameOnly: boolean;
  kind: ClaimKind;
}

/**
 * Score one customer against one prepped order. Returns a claim if the order
 * matches per the rules, otherwise null.
 */
function scoreClaim(
  customer: NewCustomer,
  custIdx: number,
  custNorm: string,
  custPost: string,
  prepped: PreppedOrder
): Claim | null {
  if (!custNorm) return null;

  let best = 0;
  let exact = false;
  for (const cand of prepped.candidates) {
    if (!cand.norm) continue;
    if (cand.norm === custNorm) {
      exact = true;
      best = 100;
      break;
    }
    const s = similarity(custNorm, cand.norm);
    if (s > best) best = s;
  }

  if (custPost) {
    const postcodeMatch =
      custPost === prepped.billingPostcode || custPost === prepped.shippingPostcode;
    if (postcodeMatch && best >= POSTCODE_THRESHOLD) {
      return { customerIndex: custIdx, order: prepped.order, score: best, exact, nameOnly: false, kind: "postcode" };
    }
    // Wider net: the postcode doesn't line up (customer moved, billing vs
    // delivery postcode differ, or an accounting typo) but the company/name is
    // a near-exact match. Accept it, flagged for verification.
    if (best >= NAME_ONLY_THRESHOLD) {
      return { customerIndex: custIdx, order: prepped.order, score: best, exact, nameOnly: true, kind: "postcode-mismatch" };
    }
    return null;
  }

  // No postcode: stricter, name-only.
  if (best >= NAME_ONLY_THRESHOLD) {
    return { customerIndex: custIdx, order: prepped.order, score: best, exact, nameOnly: true, kind: "name-only" };
  }
  return null;
}

const DATE_FMT = new Intl.DateTimeFormat("en-GB", {
  year: "numeric",
  month: "short",
  day: "2-digit",
});

/** Parse a WooCommerce money string ("292.05", "1,625.16") to a number. */
function parseMoney(v: string): number {
  const n = parseFloat(String(v).replace(/[^0-9.-]/g, ""));
  return isNaN(n) ? 0 : n;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso : DATE_FMT.format(d);
}

/** Best-effort YYYY-MM-DD from an order date (handles ISO and dd/mm/yyyy). */
function isoDate(raw: string): string | undefined {
  if (!raw) return undefined;
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const uk = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})/); // dd/mm/yyyy
  if (uk) return `${uk[3]}-${uk[2]}-${uk[1]}`;
  const d = new Date(raw);
  return isNaN(d.getTime()) ? undefined : d.toISOString().slice(0, 10);
}

/**
 * Match every customer to WooCommerce orders and resolve collisions.
 * Returns one AttributionRow per customer, in input order.
 */
export function matchCustomers(
  customers: NewCustomer[],
  orders: OrderLite[]
): AttributionRow[] {
  const prepped = orders.map(prepOrder);

  // Pass 1: gather every viable claim.
  // claimsByCustomer[custIdx] = Claim[]; claimsByOrder[orderId] = Claim[]
  const claimsByCustomer = new Map<number, Claim[]>();
  const claimsByOrder = new Map<number, Claim[]>();

  customers.forEach((customer, custIdx) => {
    const custNorm = normalizeCompany(customer.company);
    const custPost = normalizePostcode(customer.postcode);
    for (const p of prepped) {
      const claim = scoreClaim(customer, custIdx, custNorm, custPost, p);
      if (!claim) continue;
      if (!claimsByCustomer.has(custIdx)) claimsByCustomer.set(custIdx, []);
      claimsByCustomer.get(custIdx)!.push(claim);
      if (!claimsByOrder.has(claim.order.id)) claimsByOrder.set(claim.order.id, []);
      claimsByOrder.get(claim.order.id)!.push(claim);
    }
  });

  // Pass 2: collision resolution. For any order claimed by >1 customer, award
  // it to the best claimant (exact match first, then highest score) and drop
  // the losers' claims to that order.
  const droppedClaims = new Set<Claim>();
  for (const [, claims] of claimsByOrder) {
    if (claims.length < 2) continue;
    const distinctCustomers = new Set(claims.map((c) => c.customerIndex));
    if (distinctCustomers.size < 2) continue; // same customer, multiple fields — fine

    let winner = claims[0];
    for (const c of claims) {
      if (
        (c.exact && !winner.exact) ||
        (c.exact === winner.exact && c.score > winner.score)
      ) {
        winner = c;
      }
    }
    for (const c of claims) {
      if (c.customerIndex !== winner.customerIndex) droppedClaims.add(c);
    }
  }

  // Pass 3: build output rows.
  return customers.map((customer, custIdx) => {
    const rawClaims = (claimsByCustomer.get(custIdx) ?? []).filter(
      (c) => !droppedClaims.has(c)
    );

    if (rawClaims.length === 0) {
      return {
        rowIndex: customer.rowIndex,
        company: customer.company,
        postcode: customer.postcode,
        amount: customer.amount,
        status: "NOT_FOUND",
        allOrders: [],
        notes: customer.postcode
          ? "No order in this period matched this postcode or name."
          : "No order in this period matched this name (blank postcode).",
      } satisfies AttributionRow;
    }

    // Dedupe to one entry per order (a customer can claim an order via several
    // candidate fields); keep the highest score per order.
    const bestByOrder = new Map<number, Claim>();
    for (const c of rawClaims) {
      const existing = bestByOrder.get(c.order.id);
      if (!existing || c.score > existing.score) bestByOrder.set(c.order.id, c);
    }
    const claims = [...bestByOrder.values()].sort(
      (a, b) => new Date(a.order.dateCreated).getTime() - new Date(b.order.dateCreated).getTime()
    );

    // Acquisition order = earliest matched order in the window. (WooCommerce
    // core has no per-order "new customer" flag; for a set of newly-acquired
    // customers the earliest order is the acquisition order.)
    const acq = claims[0];
    // The customer counts as confidently found if any of their orders matched
    // on postcode + name; postcode-mismatch / name-only claims are flagged.
    const hasConfident = claims.some((c) => !c.nameOnly);

    const allOrders: MatchedOrderRef[] = claims.map((c) => ({
      number: c.order.number,
      date: formatDate(c.order.dateCreated),
      attribution: c.order.attribution.origin,
      score: Math.round(c.score),
    }));

    const notes: string[] = [];
    if (acq.kind === "postcode-mismatch") notes.push("postcode differs — verify");
    else if (acq.kind === "name-only") notes.push("name-only (blank postcode) — verify");
    if (claims.length > 1) notes.push(`${claims.length} orders in period; showing first`);

    return {
      rowIndex: customer.rowIndex,
      company: customer.company,
      postcode: customer.postcode,
      amount: customer.amount,
      status: hasConfident ? "MATCHED" : "NAME_ONLY",
      acqOrderNumber: acq.order.number,
      acqDate: formatDate(acq.order.dateCreated),
      acqDateIso: isoDate(acq.order.dateCreated),
      acqTotal: parseMoney(acq.order.total),
      acqEmail: acq.order.billing.email || undefined,
      acqCustomerId: acq.order.customerId || undefined,
      attribution: acq.order.attribution.origin,
      allOrders,
      score: Math.round(Math.max(...claims.map((c) => c.score))),
      notes: notes.join("; "),
    } satisfies AttributionRow;
  });
}
