import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const model = params.get("model");
  const benchmark = params.get("benchmark");
  const correct = params.get("correct");
  const problem = params.get("problem");
  const page = parseInt(params.get("page") || "0");
  const limit = parseInt(params.get("limit") || "50");
  const offset = page * limit;

  const db = getDb();

  const conditions: string[] = [];
  const values: (string | number)[] = [];

  if (model && model !== "all") {
    conditions.push("r.model_id = ?");
    values.push(model);
  }
  if (benchmark && benchmark !== "all") {
    conditions.push("r.benchmark_id = ?");
    values.push(benchmark);
  }
  if (correct === "correct") {
    conditions.push("r.correct = 1");
  } else if (correct === "incorrect") {
    conditions.push("r.correct = 0");
  }
  if (problem) {
    conditions.push("r.problem_id = ?");
    values.push(problem);
  }

  const where = conditions.length > 0 ? "WHERE " + conditions.join(" AND ") : "";

  const countRow = db
    .prepare(`SELECT COUNT(*) as total FROM runs r ${where}`)
    .get(...values) as { total: number };

  const rows = db
    .prepare(
      `SELECT r.*, m.display_name as model_name
       FROM runs r
       LEFT JOIN models m ON r.model_id = m.model_id
       ${where}
       ORDER BY r.id
       LIMIT ? OFFSET ?`
    )
    .all(...values, limit, offset);

  return NextResponse.json({
    rows,
    total: countRow.total,
    page,
    limit,
    totalPages: Math.ceil(countRow.total / limit),
  });
}
