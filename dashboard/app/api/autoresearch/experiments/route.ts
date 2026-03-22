import { NextRequest, NextResponse } from "next/server";
import { getAutoresearchDb } from "@/lib/autoresearch-db";

export async function GET(request: NextRequest) {
  const db = getAutoresearchDb();
  if (!db) {
    return NextResponse.json({ experiments: [], error: "autoresearch.db not found" });
  }

  const param = request.nextUrl.searchParams.get("run_id");

  if (param) {
    // Detail view for a single experiment
    const experiment = db
      .prepare("SELECT * FROM experiments WHERE run_id = ?")
      .get(param);

    if (!experiment) {
      return NextResponse.json({ error: "Experiment not found" }, { status: 404 });
    }

    // Per-problem results for this run
    const problems = db
      .prepare(
        `SELECT problem_id, equation1, equation2, gold_answer, predicted_answer,
                correct, cost_usd, duration_secs, prompt_tokens, completion_tokens,
                response
         FROM llm_calls WHERE run_id = ?
         ORDER BY correct ASC, problem_id`
      )
      .all(param);

    // Aggregate stats
    const stats = db
      .prepare(
        `SELECT
           COUNT(*) as total_calls,
           SUM(prompt_tokens) as prompt_tokens,
           SUM(completion_tokens) as completion_tokens,
           SUM(cost_usd) as total_cost,
           SUM(duration_secs) as total_duration,
           AVG(duration_secs) as avg_latency,
           SUM(CASE WHEN correct = 1 THEN 1 ELSE 0 END) as correct_count,
           SUM(CASE WHEN predicted_answer IS NULL THEN 1 ELSE 0 END) as unparsed
         FROM llm_calls WHERE run_id = ?`
      )
      .get(param);

    return NextResponse.json({ experiment, problems, stats });
  }

  // List all experiments with summary
  const experiments = db
    .prepare(
      `SELECT e.*,
              COUNT(c.id) as total_calls,
              SUM(c.cost_usd) as calls_total_cost,
              AVG(c.duration_secs) as avg_latency
       FROM experiments e
       LEFT JOIN llm_calls c ON e.run_id = c.run_id
       GROUP BY e.run_id
       ORDER BY e.timestamp DESC`
    )
    .all();

  return NextResponse.json({ experiments });
}
