import { NextRequest, NextResponse } from "next/server";
import Database from "better-sqlite3";
import path from "path";

const DB_PATH = path.resolve(process.cwd(), "..", "gepa_observations.db");

function getDb(): Database.Database | null {
  try {
    return new Database(DB_PATH, { readonly: true });
  } catch {
    return null;
  }
}

function tableExists(db: Database.Database, name: string): boolean {
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?")
    .get(name) as { name: string } | undefined;
  return !!row;
}

export async function GET(request: NextRequest) {
  const db = getDb();
  if (!db) {
    return NextResponse.json({ evals: [], error: "gepa_observations.db not found" });
  }

  if (!tableExists(db, "eval_runs")) {
    db.close();
    return NextResponse.json({ evals: [], error: "eval_runs table not found" });
  }

  const evalId = request.nextUrl.searchParams.get("eval_id");

  if (evalId) {
    // Detail view for a single eval
    const evalRun = db
      .prepare("SELECT * FROM eval_runs WHERE eval_id = ?")
      .get(evalId);

    if (!evalRun) {
      db.close();
      return NextResponse.json({ error: "Eval not found" }, { status: 404 });
    }

    // Per-problem results
    const results = tableExists(db, "eval_results")
      ? db
          .prepare(
            `SELECT problem_id, equation1, equation2, expected, predicted, correct,
                    response, elapsed_seconds, cost_usd, prompt_tokens, completion_tokens, error
             FROM eval_results WHERE eval_id = ?
             ORDER BY problem_id`
          )
          .all(evalId)
      : [];

    // LLM calls linked to this eval (run_id = eval_id)
    const llmCalls = tableExists(db, "llm_calls")
      ? db
          .prepare(
            `SELECT timestamp, model, role, prompt_tokens, completion_tokens,
                    cost_usd, duration_secs, prompt_full, response_preview, response_full, error
             FROM llm_calls WHERE run_id = ?
             ORDER BY timestamp ASC`
          )
          .all(evalId)
      : [];

    db.close();
    return NextResponse.json({ eval: evalRun, results, llmCalls });
  }

  // List all evals
  const evals = db
    .prepare(
      `SELECT eval_id, gepa_run_id, solver_path, solver_version, student_model,
              benchmark_subset, problem_count, started_at, finished_at, status,
              accuracy, f1_score, tp, fp, fn, tn, unparsed, parse_success_rate,
              avg_cost_usd, avg_time_secs, total_cost_usd, display_name
       FROM eval_runs ORDER BY started_at DESC`
    )
    .all();

  db.close();
  return NextResponse.json({ evals });
}
