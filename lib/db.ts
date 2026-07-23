// Persistence layer (Neon / Vercel Postgres). Server-side only.
// Reads the connection string from DATABASE_URL (set by the Vercel↔Neon
// integration) or POSTGRES_URL as a fallback.

import { neon, type NeonQueryFunction } from "@neondatabase/serverless";
import { normalizeCompany, normalizePostcode } from "./match";
import type { CohortCustomer, ConfirmCustomer, MatchStatus } from "./types";

export class DbError extends Error {}

let _sql: NeonQueryFunction<false, false> | null = null;

function getSql(): NeonQueryFunction<false, false> {
  if (_sql) return _sql;
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!url) {
    throw new DbError(
      "No database configured. Set DATABASE_URL (add a Neon/Postgres store to the Vercel project, " +
        "or put DATABASE_URL in .env.local for local dev)."
    );
  }
  _sql = neon(url);
  return _sql;
}

let _schemaReady: Promise<void> | null = null;

/** Create the table on first use (idempotent). */
export function ensureSchema(): Promise<void> {
  if (_schemaReady) return _schemaReady;
  const sql = getSql();
  _schemaReady = (async () => {
    await sql`
      CREATE TABLE IF NOT EXISTS cohort_customers (
        id SERIAL PRIMARY KEY,
        wc_key TEXT UNIQUE NOT NULL,
        company TEXT NOT NULL,
        postcode TEXT,
        email TEXT,
        wc_customer_id INTEGER,
        attribution TEXT NOT NULL,
        attribution_source TEXT NOT NULL DEFAULT 'auto',
        acq_order_number TEXT,
        acq_date DATE,
        acq_total NUMERIC(12,2),
        status_at_confirm TEXT,
        total_spend NUMERIC(12,2),
        order_count INTEGER,
        last_order_date DATE,
        spend_6m NUMERIC(12,2),
        spend_12m NUMERIC(12,2),
        spend_18m NUMERIC(12,2),
        avg_monthly_spend NUMERIC(12,2),
        months_tracked INTEGER,
        spend_refreshed_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`;
  })();
  return _schemaReady;
}

/** Stable natural key for upserts: email if we have one, else company+postcode. */
export function customerKey(c: { email?: string; company: string; postcode: string }): string {
  const email = (c.email ?? "").trim().toLowerCase();
  if (email) return `em:${email}`;
  return `co:${normalizeCompany(c.company)}|${normalizePostcode(c.postcode)}`;
}

const num = (v: unknown): number | null =>
  v == null ? null : typeof v === "number" ? v : isNaN(parseFloat(String(v))) ? null : parseFloat(String(v));
const dstr = (v: unknown): string | null => {
  if (v == null) return null;
  const s = v instanceof Date ? v.toISOString() : String(v);
  return s.slice(0, 10);
};

/* eslint-disable @typescript-eslint/no-explicit-any */
function mapRow(r: any): CohortCustomer {
  return {
    id: Number(r.id),
    company: r.company,
    postcode: r.postcode ?? "",
    email: r.email ?? null,
    wcCustomerId: r.wc_customer_id == null ? null : Number(r.wc_customer_id),
    attribution: r.attribution,
    attributionSource: r.attribution_source,
    acqOrderNumber: r.acq_order_number ?? null,
    acqDate: dstr(r.acq_date),
    acqTotal: num(r.acq_total),
    statusAtConfirm: (r.status_at_confirm ?? "MATCHED") as MatchStatus,
    totalSpend: num(r.total_spend),
    orderCount: r.order_count == null ? null : Number(r.order_count),
    lastOrderDate: dstr(r.last_order_date),
    spend6m: num(r.spend_6m),
    spend12m: num(r.spend_12m),
    spend18m: num(r.spend_18m),
    avgMonthlySpend: num(r.avg_monthly_spend),
    monthsTracked: r.months_tracked == null ? null : Number(r.months_tracked),
    spendRefreshedAt: r.spend_refreshed_at ? new Date(r.spend_refreshed_at).toISOString() : null,
    createdAt: new Date(r.created_at).toISOString(),
  };
}

/** Insert or update each confirmed customer. Returns { inserted, updated }. */
export async function upsertCustomers(
  customers: ConfirmCustomer[]
): Promise<{ saved: number }> {
  await ensureSchema();
  const sql = getSql();
  let saved = 0;
  for (const c of customers) {
    const key = customerKey(c);
    const email = (c.email ?? "").trim().toLowerCase() || null;
    await sql`
      INSERT INTO cohort_customers
        (wc_key, company, postcode, email, wc_customer_id, attribution, attribution_source,
         acq_order_number, acq_date, acq_total, status_at_confirm, updated_at)
      VALUES
        (${key}, ${c.company}, ${c.postcode}, ${email}, ${c.wcCustomerId ?? null},
         ${c.attribution}, ${c.attributionSource}, ${c.acqOrderNumber ?? null},
         ${c.acqDate ?? null}, ${c.acqTotal ?? null}, ${c.statusAtConfirm}, now())
      ON CONFLICT (wc_key) DO UPDATE SET
        company = EXCLUDED.company,
        postcode = EXCLUDED.postcode,
        email = COALESCE(EXCLUDED.email, cohort_customers.email),
        wc_customer_id = COALESCE(EXCLUDED.wc_customer_id, cohort_customers.wc_customer_id),
        attribution = EXCLUDED.attribution,
        attribution_source = EXCLUDED.attribution_source,
        acq_order_number = COALESCE(cohort_customers.acq_order_number, EXCLUDED.acq_order_number),
        acq_date = LEAST(cohort_customers.acq_date, EXCLUDED.acq_date),
        acq_total = COALESCE(cohort_customers.acq_total, EXCLUDED.acq_total),
        status_at_confirm = EXCLUDED.status_at_confirm,
        updated_at = now()`;
    saved++;
  }
  return { saved };
}

export async function getCohort(): Promise<CohortCustomer[]> {
  await ensureSchema();
  const sql = getSql();
  const rows = await sql`SELECT * FROM cohort_customers ORDER BY acq_date DESC NULLS LAST, created_at DESC`;
  return (rows as any[]).map(mapRow);
}

/** Per-customer spend snapshot to persist after a refresh. */
export interface SpendSnapshot {
  id: number;
  totalSpend: number;
  orderCount: number;
  lastOrderDate: string | null;
  spend6m: number;
  spend12m: number;
  spend18m: number;
  avgMonthlySpend: number;
  monthsTracked: number;
}

export async function saveSpendSnapshots(snaps: SpendSnapshot[]): Promise<void> {
  await ensureSchema();
  const sql = getSql();
  const now = new Date().toISOString();
  for (const s of snaps) {
    await sql`
      UPDATE cohort_customers SET
        total_spend = ${s.totalSpend},
        order_count = ${s.orderCount},
        last_order_date = ${s.lastOrderDate},
        spend_6m = ${s.spend6m},
        spend_12m = ${s.spend12m},
        spend_18m = ${s.spend18m},
        avg_monthly_spend = ${s.avgMonthlySpend},
        months_tracked = ${s.monthsTracked},
        spend_refreshed_at = ${now},
        updated_at = now()
      WHERE id = ${s.id}`;
  }
}

export async function deleteCustomer(id: number): Promise<void> {
  await ensureSchema();
  const sql = getSql();
  await sql`DELETE FROM cohort_customers WHERE id = ${id}`;
}
/* eslint-enable @typescript-eslint/no-explicit-any */
