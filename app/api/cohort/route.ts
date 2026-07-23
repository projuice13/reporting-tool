// Read (and delete from) the saved cohort.

import { NextResponse } from "next/server";
import { getCohort, deleteCustomer, DbError } from "@/lib/db";
import { summarizeCohort } from "@/lib/cohort";
import type { CohortResponse } from "@/lib/types";

export const runtime = "nodejs";

export async function GET() {
  try {
    const customers = await getCohort();
    const spendRefreshedAt = customers.reduce<string | null>(
      (latest, c) => (c.spendRefreshedAt && (!latest || c.spendRefreshedAt > latest) ? c.spendRefreshedAt : latest),
      null
    );
    const body: CohortResponse = { customers, summary: summarizeCohort(customers), spendRefreshedAt };
    return NextResponse.json(body);
  } catch (err) {
    const status = err instanceof DbError ? 500 : 500;
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed to load cohort." }, { status });
  }
}

export async function DELETE(request: Request) {
  const id = Number(new URL(request.url).searchParams.get("id"));
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: "A valid id is required." }, { status: 400 });
  }
  try {
    await deleteCustomer(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed to delete." }, { status: 500 });
  }
}
