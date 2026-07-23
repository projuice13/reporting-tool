// Client-side CSV parsing + column detection for the new-customer upload.

import Papa from "papaparse";
import type { NewCustomer } from "./types";

export interface ParseResult {
  customers: NewCustomer[];
  /** Header names actually used, for the preview / confirmation. */
  companyHeader: string;
  postcodeHeader: string;
  amountHeader?: string;
}

export class CsvError extends Error {}

const COMPANY_ALIASES = ["company", "name", "customer", "account"];
const POSTCODE_ALIASES = ["postcode", "post code", "zip", "zipcode", "postal code"];
const AMOUNT_ALIASES = ["amount", "total", "value"];

/** Find a header whose normalised name matches one of the aliases. */
function findHeader(headers: string[], aliases: string[]): string | undefined {
  const norm = (s: string) => s.replace(/^﻿/, "").trim().toLowerCase();
  // Exact alias match first (so "Company" wins over "Company Reg No").
  for (const alias of aliases) {
    const hit = headers.find((h) => norm(h) === alias);
    if (hit) return hit;
  }
  // Then a startsWith fallback.
  for (const alias of aliases) {
    const hit = headers.find((h) => norm(h).startsWith(alias));
    if (hit) return hit;
  }
  return undefined;
}

/**
 * Parse the uploaded file into NewCustomer rows.
 * Detects Company + Postcode columns, strips BOM, ignores blank rows/columns.
 */
export function parseCustomerCsv(file: File): Promise<ParseResult> {
  return new Promise((resolve, reject) => {
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: "greedy",
      transformHeader: (h) => h.replace(/^﻿/, "").trim(),
      complete: (results) => {
        try {
          const headers = (results.meta.fields ?? []).filter((h) => h && h.trim());
          if (headers.length === 0) {
            throw new CsvError("The CSV appears to have no header row.");
          }

          const companyHeader = findHeader(headers, COMPANY_ALIASES);
          const postcodeHeader = findHeader(headers, POSTCODE_ALIASES);
          const amountHeader = findHeader(headers, AMOUNT_ALIASES);

          if (!companyHeader) {
            throw new CsvError(
              `Couldn't find a "Company" column. Expected a header like Company / Name. ` +
                `Found: ${headers.join(", ")}`
            );
          }
          if (!postcodeHeader) {
            throw new CsvError(
              `Couldn't find a "Postcode" column. Expected a header like Postcode / Post code / Zip. ` +
                `Found: ${headers.join(", ")}`
            );
          }

          const customers: NewCustomer[] = [];
          results.data.forEach((row) => {
            const company = (row[companyHeader] ?? "").trim();
            const postcode = (row[postcodeHeader] ?? "").trim();
            const amount = amountHeader ? (row[amountHeader] ?? "").trim() : undefined;
            // Skip fully-blank rows (blank postcode alone is allowed).
            if (!company && !postcode && !amount) return;
            if (!company) return; // a row with no company is unusable
            customers.push({
              rowIndex: customers.length,
              company,
              postcode,
              amount: amount || undefined,
            });
          });

          if (customers.length === 0) {
            throw new CsvError("No customer rows found in the CSV.");
          }

          resolve({ customers, companyHeader, postcodeHeader, amountHeader });
        } catch (err) {
          reject(err);
        }
      },
      error: (err) => reject(new CsvError(err.message)),
    });
  });
}
