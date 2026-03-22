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

  let db: ReturnType<typeof getDb>;
  try {
    db = getDb();
  } catch (e) {
    return NextResponse.json(
      { error: `Failed to open data.db: ${e instanceof Error ? e.message : e}` },
      { status: 503 },
    );
  }

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
    conditions.push("r.problem_id LIKE ?");
    values.push(`%${problem}%`);
  }

  const where = conditions.length > 0 ? "WHERE " + conditions.join(" AND ") : "";

  const statsRow = db
    .prepare(
      `SELECT COUNT(*) as total, SUM(r.correct) as correct_count FROM runs r ${where}`
    )
    .get(...values) as { total: number; correct_count: number };

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
    total: statsRow.total,
    correctCount: statsRow.correct_count || 0,
    page,
    limit,
    totalPages: Math.ceil(statsRow.total / limit),
  });
}
