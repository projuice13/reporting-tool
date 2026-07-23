// Save a confirmed report into the persistent cohort.

import { NextResponse } from "next/server";
import { upsertCustomers, DbError } from "@/lib/db";
import type { ConfirmRequest } from "@/lib/types";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let body: ConfirmRequest;
  try {
    body = (await request.json()) as ConfirmRequest;
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const customers = body?.customers;
  if (!Array.isArray(customers) || customers.length === 0) {
    return NextResponse.json({ error: "No customers to save." }, { status: 400 });
  }
  // Every saved customer needs an attribution.
  for (const c of customers) {
    if (!c.company || !c.attribution) {
      return NextResponse.json(
        { error: "Each customer needs a company and an attribution before saving." },
        { status: 400 }
      );
    }
  }

  try {
    const { saved } = await upsertCustomers(customers);
    return NextResponse.json({ saved });
  } catch (err) {
    const status = err instanceof DbError ? 500 : 500;
    const message = err instanceof Error ? err.message : "Failed to save cohort.";
    return NextResponse.json({ error: message }, { status });
  }
}
