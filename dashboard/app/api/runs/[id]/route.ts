import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const db = getDb();

  const row = db
    .prepare(
      `SELECT r.*, m.display_name as model_name
       FROM runs r
       LEFT JOIN models m ON r.model_id = m.model_id
       WHERE r.id = ?`
    )
    .get(id);

  if (!row) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json(row);
}
