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
