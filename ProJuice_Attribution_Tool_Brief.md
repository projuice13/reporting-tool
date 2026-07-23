# Build Brief — New Customer Attribution Tool

## 1. Goal

A lightweight internal web tool for ProJuice that attributes newly-acquired customers to a marketing source. The user uploads a CSV of new customers (exported from the accounting system), picks a month, and the tool pulls that month's orders live from the WooCommerce store via the REST API, matches each new customer to their order, and displays a table showing each customer's acquisition **attribution** (Direct / Organic: Google / Source: Adwords / Referral, etc.). Customers that can't be found in the website orders are flagged.

This replaces a manual two-CSV cross-reference process. It is internal-only, single-user, no auth, no database.

## 2. Tech stack

- **Next.js** (App Router, TypeScript) — a single page plus one server route handler.
- **Tailwind CSS** for styling. Keep it plain and functional.
- **papaparse** (client-side) for CSV parsing.
- One small fuzzy-matching utility (hand-rolled; see §7). Avoid heavy deps.
- Deploy target: Vercel (matches existing ProJuice tooling). All secrets in environment variables.

No database. No state persistence. Everything is request/response.

## 3. End-to-end flow

1. User opens the page.
2. User uploads a **New Customers CSV** and selects a **month + year**. Optionally selects which order statuses to include (default: `processing`, `completed`).
3. Client parses the CSV, then POSTs `{ customers, year, month, statuses }` to `/api/attribute`.
4. The server route builds the month's date window, paginates through all matching WooCommerce orders, extracts each order's billing/shipping identity + attribution meta, runs the matching algorithm, and returns a results payload.
5. The client renders a results table with an attribution summary, highlights unmatched customers, and offers a CSV/XLSX export.

## 4. Architecture — why the API calls are server-side

The WooCommerce consumer key/secret must **never** reach the browser. All WooCommerce calls happen inside the Next.js route handler (`app/api/attribute/route.ts`), which runs on the server. The client only ever sends the parsed customer list and the chosen month, and receives back the matched results. This is the single most important security constraint.

## 5. Environment variables

```
WC_STORE_URL=https://projuice.co.uk        # no trailing slash
WC_CONSUMER_KEY=ck_xxxxxxxxxxxxxxxxxxxxxxxx  # READ-ONLY key
WC_CONSUMER_SECRET=cs_xxxxxxxxxxxxxxxxxxxxxx
WC_ORDER_STATUSES=processing,completed      # optional default
```

Generate a **read-only** REST API key in WooCommerce → Settings → Advanced → REST API. Read-only is sufficient — the tool never writes.

## 6. WooCommerce REST API integration

**Endpoint:** `GET {WC_STORE_URL}/wp-json/wc/v3/orders`

**Auth:** HTTP Basic auth over HTTPS — `Authorization: Basic base64(consumer_key:consumer_secret)`. (Query-string auth also works but Basic is cleaner.)

**Query params:**

| Param | Value |
|---|---|
| `after` | ISO 8601 start of month, e.g. `2026-06-01T00:00:00` |
| `before` | ISO 8601 start of the **next** month (exclusive), e.g. `2026-07-01T00:00:00` |
| `status` | comma-separated list from the status filter |
| `per_page` | `100` (the API max) |
| `page` | 1-based; increment until done |
| `orderby` | `date` |
| `order` | `asc` |

**Pagination:** read the `X-WP-Total` and `X-WP-TotalPages` response headers on the first request, then loop `page=1..TotalPages`. Filtering by `date_created` is the default for `after`/`before`.

**Timezone caveat:** the REST API treats `after`/`before` as GMT unless an offset is supplied. ProJuice is UK-based (BST in summer). Either pass the boundaries with the store's UTC offset, or accept a possible 1-hour edge effect on orders placed just after midnight on the first/last day of the month. Document whichever choice is made; for month-level attribution it is immaterial in practice.

**Fields needed per order** (from the JSON response):

- `id`, `number`, `date_created`
- `billing.company`, `billing.postcode`, `billing.first_name`, `billing.last_name`, `billing.email`
- `shipping.company`, `shipping.postcode`, `shipping.first_name`, `shipping.last_name`
- `total`
- `meta_data[]` — for the attribution keys below

**Order attribution (the "attribution" the tool reports).** WooCommerce's built-in Order Attribution (core since 8.5) stores data as order meta, returned in the `meta_data` array as `{ id, key, value }`. Relevant keys:

| Meta key | Meaning |
|---|---|
| `_wc_order_attribution_origin` | Friendly label — e.g. `Direct`, `Organic: Google`, `Source: Adwords`, `Referral: bing.com`. **Use this directly when present.** |
| `_wc_order_attribution_source_type` | `typein`, `organic`, `referral`, `utm`, `admin`, `mobile_app` |
| `_wc_order_attribution_utm_source` | e.g. `google`, `adwords`, `bing` |
| `_wc_order_attribution_utm_medium` | e.g. `cpc`, `organic`, `referral` |
| `_wc_order_attribution_utm_campaign` | campaign name |
| `_wc_order_attribution_referrer` | full referrer URL |
| `_wc_order_attribution_device_type` | Mobile / Tablet / Desktop |

**Origin resolution:** prefer `_wc_order_attribution_origin` verbatim (it matches the labels the store already produces). If that key is absent, derive a label from `source_type` + `utm_source` / `referrer`:

- `typein` or empty → `Direct`
- `organic` → `Organic: {Title-cased utm_source}`
- `utm` → `Source: {Title-cased utm_source}`
- `referral` → `Referral: {hostname of referrer}`
- `admin` → `Web admin`
- anything else / missing → `Unknown`

> Note: attribution only exists for orders placed **after** the feature was enabled on the store. Older orders will have no attribution meta → report as `Unknown / not tracked`.

## 7. Input CSV handling

The accounting export looks like: a `Company` column, a `Postcode` column, an `Amount` column, and possibly trailing empty columns and a UTF-8 BOM.

- Detect the **Company** and **Postcode** columns by case-insensitive header match (accept `company`, `postcode`/`post code`/`zip`). Carry `Amount` through untouched if present.
- Strip the BOM; ignore blank trailing columns and fully-blank rows.
- A row may legitimately have a **blank postcode** — keep it and handle via name-only matching (see below).
- The "Company" value is sometimes a **person's name** (individual customers), not a business. The matching logic must account for this.

## 8. Matching algorithm (the core logic)

For each new customer, find the WooCommerce order(s) that belong to them, then take their attribution. This mirrors a process already validated against real ProJuice data. Implement as a small TypeScript module (`lib/match.ts`).

**Normalisation**

- **Company/name:** lowercase → strip punctuation → remove company suffixes (`ltd`, `limited`, `llp`, `plc`, `co`, `company`, `inc`, `the`) → collapse whitespace.
- **Postcode:** uppercase → remove all non-alphanumerics (so `sw20 0et` → `SW200ET`).

**Candidate fields per order:** billing company, shipping company, billing full name (`first + last`), shipping full name. (Individual customers have a blank company but a name — so names must be matched, not just company fields.)

**Similarity:** a token-sort ratio (0–100) built on Levenshtein distance, plus a substring/partial-ratio check. `max(tokenSort, partial)`. (A ~40-line util; no need for a library, but `fastest-levenshtein` is acceptable if preferred.)

**Match rule for a customer with a postcode:**
- The order matches if **postcode matches** (customer postcode == billing **or** shipping postcode, normalised) **AND** the best company/name similarity across the four candidate fields ≥ **85**.

**Match rule for a customer with no postcode:**
- Match on name/company similarity only, with a stricter threshold ≥ **93**. Flag these matches as "name-only — verify".

**Collision resolution:** if one order is claimed by more than one new customer (e.g. two similarly-named businesses share a postcode), award the order to the customer with (a) an exact normalised field match, then (b) the highest similarity score. A customer left with no order becomes **NOT FOUND**.

**Acquisition attribution (per customer):** a customer may have several orders in the month. Report the attribution of their **first "new"-flagged order**; if none is flagged new, use the earliest order and note it. Also expose the full list of matched orders.

**Rationale for these rules** (validated on real data): postcode is a strong, near-unique key in the UK, so postcode + a confident company/name match is highly reliable; individuals order under a blank company with their name in the billing name fields; and businesses frequently appear under slight name variants (`Franzo` → `Franzos - Coventry`, `Function Coffee Ltd` → `Function Coffee Limited`) that exact matching would miss.

## 9. UI spec

Single page, centred, ~720px max width. Plain and quick.

- **Header:** title + one-line description.
- **Upload zone:** file input (drag-drop optional) accepting `.csv`. After parse, show a small confirmation ("64 customers loaded") and, on request, a collapsible preview of the first few rows.
- **Month selector:** a month + year picker (or two selects). Default to the previous calendar month.
- **Status filter (optional, collapsed):** checkboxes for order statuses; default `processing` + `completed`.
- **Run button:** disabled until a file is loaded and a month chosen. Shows a spinner + "Fetching {Month} orders…" while working.
- **Error states:** clear inline messages for API auth failure, no orders found, malformed CSV, or missing Company/Postcode columns.

## 10. Output

**Results table**, one row per new customer:

| Company | Postcode | Status | Acq. Order # | Date | Attribution | All Orders | Notes |
|---|---|---|---|---|---|---|---|

- **NOT FOUND** rows highlighted yellow (`bg-yellow-200`).
- Sortable columns; a text filter box; a toggle to show only unmatched.
- **Attribution summary** panel above the table: count and % of *matched* customers per acquisition source (Direct / Organic: Google / Source: Adwords / Referral… ), plus a "not found in orders" count.
- **Export** button → download the table as CSV (and XLSX if easy) preserving the yellow flag as a "Status" column.

## 11. Edge cases & guardrails

- Month with a large order count → pagination must complete all pages before matching.
- Orders with no attribution meta → `Unknown / not tracked`.
- Customers whose postcode never appears in the month's orders → NOT FOUND (they likely ordered via phone/rep/another channel; state this in a footnote).
- Same postcode, different businesses → do not falsely merge (collision rule handles it).
- Rate limiting / transient API errors → retry a page a couple of times with backoff; surface a clear error if it still fails.
- Keep the whole request within Vercel's function timeout; if a month is unusually large, fetch pages concurrently in small batches.

## 12. Suggested file structure

```
app/
  page.tsx                 # UI: upload, month picker, run, results table
  api/attribute/route.ts   # server: WooCommerce fetch + match + respond
lib/
  woocommerce.ts           # auth, paginated order fetch, meta extraction, origin resolution
  match.ts                 # normalisation, similarity, matching, collision resolution
  csv.ts                   # client-side parse + column detection (papaparse)
  types.ts                 # NewCustomer, OrderLite, MatchResult, AttributionRow
components/
  ResultsTable.tsx
  AttributionSummary.tsx
```

## 13. Out of scope (for now)

- Writing anything back to WooCommerce.
- Multi-user auth / saved history.
- Reading the customer list directly from the accounting system's API (CSV upload is fine for v1; could be a v2).

## 14. Acceptance criteria

- Uploading a valid new-customer CSV and selecting a month returns a table within a reasonable time.
- Every matched customer shows a correct acquisition attribution pulled from live WooCommerce order meta.
- Individuals (blank company, name in billing) are matched via name; business name variants are tolerated.
- Unmatched customers are clearly flagged yellow and counted.
- Consumer key/secret never appear in any client-side response or bundle.
- Results are exportable.
