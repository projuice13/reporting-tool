// Shared types for the attribution tool.

/** A row from the uploaded new-customer CSV. */
export interface NewCustomer {
  /** 0-based index of the source row (for stable keys / collision resolution). */
  rowIndex: number;
  /** "Company" value — may actually be a person's name for individual customers. */
  company: string;
  /** Postcode; may legitimately be blank. */
  postcode: string;
  /** "Amount" carried through untouched if present in the CSV. */
  amount?: string;
}

/** WooCommerce order attribution meta, resolved to friendly values. */
export interface OrderAttribution {
  /** Friendly origin label, e.g. "Direct", "Organic: Google", "Source: Adwords". */
  origin: string;
  sourceType?: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  referrer?: string;
  deviceType?: string;
}

/** A trimmed-down order — only the fields the tool needs. */
export interface OrderLite {
  id: number;
  number: string;
  /** WooCommerce customer id; 0 for guest orders. */
  customerId: number;
  /** ISO date_created string as returned by the API. */
  dateCreated: string;
  billing: {
    company: string;
    postcode: string;
    firstName: string;
    lastName: string;
    email: string;
  };
  shipping: {
    company: string;
    postcode: string;
    firstName: string;
    lastName: string;
  };
  total: string;
  attribution: OrderAttribution;
}

export type MatchStatus = "MATCHED" | "NAME_ONLY" | "NOT_FOUND";

/** One order attached to a matched customer, with the score it matched at. */
export interface MatchedOrderRef {
  number: string;
  date: string;
  attribution: string;
  score: number;
}

/** One output row — a customer plus their resolved attribution. */
export interface AttributionRow {
  rowIndex: number;
  company: string;
  postcode: string;
  amount?: string;
  status: MatchStatus;
  /** Acquisition order number (the order whose attribution we report). */
  acqOrderNumber?: string;
  acqDate?: string;
  /** Raw ISO date of the acquisition order (for persistence / month math). */
  acqDateIso?: string;
  /** Total value of the acquisition (first) order, numeric. */
  acqTotal?: number;
  /** Billing email + WooCommerce customer id of the acquisition order (identity for tracking). */
  acqEmail?: string;
  acqCustomerId?: number;
  attribution?: string;
  /** All orders matched to this customer. */
  allOrders: MatchedOrderRef[];
  /** Best similarity score achieved (0-100). */
  score?: number;
  notes: string;
}

/** One line in the attribution summary panel. */
export interface SummaryLine {
  label: string;
  count: number;
  /** Summed value of the acquisition (first) orders in this bucket. */
  value: number;
  /** Percentage of matched customers (0-100, one decimal). */
  percent: number;
}

export interface AttributeResponse {
  rows: AttributionRow[];
  summary: SummaryLine[];
  totalCustomers: number;
  matchedCount: number;
  nameOnlyCount: number;
  notFoundCount: number;
  ordersFetched: number;
  /** Human-readable window description, e.g. "1 Jun 2026 – 30 Jun 2026". */
  rangeLabel: string;
  /** Whether any timezone note applies. */
  timezoneNote: string;
}

export interface AttributeRequest {
  customers: NewCustomer[];
  /** Inclusive start date, YYYY-MM-DD. */
  from: string;
  /** Inclusive end date, YYYY-MM-DD. */
  to: string;
  statuses?: string[];
}

// ---------------------------------------------------------------------------
// Cohort tracking (persisted)
// ---------------------------------------------------------------------------

/** One customer as sent to /api/cohort/confirm to be saved. */
export interface ConfirmCustomer {
  company: string;
  postcode: string;
  /** Billing email — the primary identity used to track future orders. */
  email?: string;
  wcCustomerId?: number;
  /** The confirmed attribution (auto-detected or hand-picked). */
  attribution: string;
  attributionSource: "auto" | "manual";
  acqOrderNumber?: string;
  /** ISO date (YYYY-MM-DD) of the acquisition order, if known. */
  acqDate?: string;
  acqTotal?: number;
  statusAtConfirm: MatchStatus;
}

export interface ConfirmRequest {
  customers: ConfirmCustomer[];
}

/** A saved cohort customer with its latest spend snapshot. */
export interface CohortCustomer {
  id: number;
  company: string;
  postcode: string;
  email: string | null;
  wcCustomerId: number | null;
  attribution: string;
  attributionSource: "auto" | "manual";
  acqOrderNumber: string | null;
  acqDate: string | null; // YYYY-MM-DD
  acqTotal: number | null;
  statusAtConfirm: MatchStatus;
  // Spend snapshot (null until first refresh):
  totalSpend: number | null;
  orderCount: number | null;
  lastOrderDate: string | null;
  spend6m: number | null;
  spend12m: number | null;
  spend18m: number | null;
  avgMonthlySpend: number | null;
  monthsTracked: number | null;
  spendRefreshedAt: string | null;
  createdAt: string;
}

/** Cohort value rolled up by attribution source. */
export interface CohortSourceSummary {
  attribution: string;
  customers: number;
  totalAcqValue: number;
  totalSpend: number;
  avgMonthlySpend: number;
  avg6m: number;
  avg12m: number;
  avg18m: number;
  /** How many customers have reached each tenure (denominator honesty). */
  mature6m: number;
  mature12m: number;
  mature18m: number;
}

export interface CohortResponse {
  customers: CohortCustomer[];
  summary: CohortSourceSummary[];
  spendRefreshedAt: string | null;
}
