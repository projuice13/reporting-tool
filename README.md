# ProJuice — New Customer Attribution Tool

A lightweight internal web tool that attributes newly-acquired ProJuice customers to a
marketing source. Upload a CSV of new customers (from the accounting export), pick a month,
and the tool pulls that month's orders **live** from the WooCommerce store, matches each new
customer to their order, and shows each customer's acquisition attribution
(Direct / Organic: Google / Source: Adwords / Referral…). Customers who can't be found in the
website orders are flagged.

Internal-only, single-user, no auth, no database. Everything is request/response.

## Setup

1. **Install dependencies**

   ```bash
   npm install
   ```

2. **Configure WooCommerce credentials.** Copy `.env.example` to `.env.local` and fill in a
   **read-only** REST API key (WooCommerce → Settings → Advanced → REST API):

   ```
   WC_STORE_URL=https://projuice.co.uk        # no trailing slash
   WC_CONSUMER_KEY=ck_xxxxxxxxxxxxxxxxxxxxxxxx  # READ-ONLY key
   WC_CONSUMER_SECRET=cs_xxxxxxxxxxxxxxxxxxxxxx
   WC_ORDER_STATUSES=processing,completed      # optional default
   ```

   These are read **server-side only** and never reach the browser.

3. **Provision the database** (for the cohort tracker). On Vercel: open the project →
   **Storage** → **Create Database** → **Neon (Postgres)** → connect it. Vercel injects
   `DATABASE_URL` automatically. For local dev, paste your Neon connection string into
   `.env.local` as `DATABASE_URL`. The `cohort_customers` table is created automatically on
   first use — no migration step. Without a database, the attribution report still works; only
   the save/cohort features are disabled (with a clear message).

3. **Run**

   ```bash
   npm run dev      # http://localhost:3000
   # or
   npm run build && npm start
   ```

## How to use

1. Upload the **New Customers CSV** (a `Company` column, a `Postcode` column, optionally
   `Amount`; BOM and blank trailing columns are handled). The tool auto-detects the columns.
2. Pick a **date range** (from / to, inclusive; defaults to the previous calendar month).
3. Optionally open **Order statuses** to change which statuses are included
   (default `processing` + `completed`).
4. Click **Run attribution**. The server paginates all matching WooCommerce orders for the
   month, matches customers, and returns the results.
5. Review the table, use the filter / "only unmatched" toggle, and **Export CSV / XLSX**.

## How it works

- The browser parses the CSV (papaparse) and POSTs `{ customers, year, month, statuses }`
  to `/api/attribute`.
- `app/api/attribute/route.ts` (server) builds the month window, fetches all orders from the
  WooCommerce REST API (Basic auth, `X-WP-TotalPages` pagination, concurrent batches with
  retry/backoff), extracts billing/shipping identity + order-attribution meta, runs the
  matcher, and returns the results.
- **Matching** (`lib/match.ts`, pure/testable):
  - Normalise company/name (lowercase, strip punctuation, drop company suffixes) and postcode
    (uppercase, alphanumerics only).
  - Similarity = `max(tokenSortRatio, partialRatio)` on Levenshtein distance (0–100).
  - Similarity is also computed with whitespace removed, so spacing-only variants
    ("Bio Reliance" vs "BioReliance") score as near-identical.
  - **With a matching postcode:** match if postcode == billing **or** shipping postcode **and**
    best company/name similarity ≥ **85**.
  - **Postcode differs:** if the postcode doesn't line up (customer moved, billing ≠ delivery,
    or an accounting typo) but the name is a near-exact match ≥ **93**, it still matches, flagged
    "postcode differs — verify". This is the main "wider net" that reduces false NOT FOUNDs.
  - **No postcode:** name/company similarity only, ≥ **93**, flagged "name-only — verify".
  - **Collision resolution:** an order claimed by two customers goes to the exact match, then
    the higher score; the loser becomes **NOT FOUND** (no false merges).
  - Acquisition attribution comes from the customer's **earliest** matched order in the range;
    if they ordered more than once, only that first order counts (attribution **and** value).
  - The summary panel shows, per source, the customer count, % of matched, and the summed
    **£ value of those first orders**, plus a grand total.
  - Thresholds are named constants (`POSTCODE_THRESHOLD`, `NAME_ONLY_THRESHOLD`) — tune there.

## Cohort tracking (persistent)

Beyond the one-off report, the tool tracks the ongoing value of acquired customers:

1. On the report, each row's **attribution is editable** (a dropdown of common sources + free
   text). For **NOT FOUND** rows you investigate the source, pick it, and optionally add the
   customer's **email** so their future orders can be tracked.
2. **Confirm & save report** upserts every attributed row into the `cohort_customers` table,
   keyed on the customer's email (or company+postcode if no email) so re-running a period never
   duplicates them. Manual attributions are flagged as such.
3. The **Cohort dashboard** (`/cohort`) shows every saved customer and, per acquisition source,
   the customer count, acquisition value, total website spend, average monthly spend, and the
   average spend reached by **6 / 12 / 18 months** of tenure (averaged only over customers old
   enough to have reached that window).
4. **Refresh spend** (manual) does one paginated sweep of WooCommerce orders from the earliest
   acquisition date to today, attributes them to saved customers by email / customer id, and
   recomputes every snapshot. Customers with no email/customer id are shown as "no identity"
   (their website spend can't be tracked).

Relevant files: `lib/db.ts` (Neon schema + queries), `lib/cohort.ts` (pure spend maths),
`app/api/cohort/*` (confirm / read / refresh), `app/cohort/page.tsx` (dashboard).

## Notes / decisions

- **Attribution origin** prefers WooCommerce's own `_wc_order_attribution_origin` verbatim;
  if absent it is derived from `source_type` + `utm_source` / `referrer`. Orders placed before
  Order Attribution was enabled have no meta → reported as `Unknown / not tracked`.
- **Timezone:** month boundaries are sent without an offset, so the REST API treats them as
  GMT. A possible 1-hour edge effect around midnight on the first/last day is immaterial for
  month-level attribution.
- **"Not found" customers** likely ordered via phone, a rep, or another channel and simply
  aren't in the website orders.
- **Acquisition order:** WooCommerce core has no per-order "new customer" flag, so the earliest
  matched order in the month is treated as the acquisition order; all matched orders are listed.

## Project structure

```
app/
  page.tsx                 # UI: upload, month picker, run, results, export
  api/attribute/route.ts   # server: WooCommerce fetch + match + respond
lib/
  woocommerce.ts           # auth, paginated fetch, meta extraction, origin resolution
  match.ts                 # normalisation, similarity, matching, collision resolution
  csv.ts                   # client CSV parse + column detection (papaparse)
  export.ts                # CSV / XLSX export
  types.ts                 # shared types
components/
  ResultsTable.tsx         # sortable, filterable results table
  AttributionSummary.tsx   # per-source counts + %
```

## Deploy

Targets Vercel. Set `WC_STORE_URL`, `WC_CONSUMER_KEY`, `WC_CONSUMER_SECRET` (and optionally
`WC_ORDER_STATUSES`) as environment variables in the Vercel project. The `/api/attribute`
route runs server-side (`maxDuration = 60`), so credentials never enter the client bundle.
