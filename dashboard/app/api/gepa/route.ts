import { NextRequest, NextResponse } from "next/server";
import Database from "better-sqlite3";
import path from "path";

const DB_PATH = path.resolve(process.cwd(), "..", "gepa_observations.db");

function getGepaDb(): Database.Database | null {
  try {
    return new Database(DB_PATH, { readonly: true });
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest) {
  const db = getGepaDb();
  if (!db) {
    return NextResponse.json({ runs: [], error: "gepa_observations.db not found" });
  }

  const param = request.nextUrl.searchParams.get("run_id");

  if (param) {
    // Detail view for a single run
    const run = db.prepare("SELECT * FROM runs WHERE run_id = ?").get(param);
    if (!run) {
      db.close();
      return NextResponse.json({ error: "Run not found" }, { status: 404 });
    }

    const calls = db
      .prepare(
        `SELECT model, role,
                COUNT(*) as calls,
                SUM(prompt_tokens) as prompt_tokens,
                SUM(completion_tokens) as completion_tokens,
                SUM(cost_usd) as cost_usd,
                SUM(duration_secs) as duration_secs,
                SUM(CASE WHEN error IS NOT NULL THEN 1 ELSE 0 END) as errors
         FROM llm_calls WHERE run_id = ? GROUP BY model, role`
      )
      .all(param);

    const timeline = db
      .prepare(
        `SELECT CAST((timestamp - (SELECT MIN(timestamp) FROM llm_calls WHERE run_id = ?)) / 10 AS INTEGER) * 10 as bucket,
                role,
                COUNT(*) as calls,
                SUM(cost_usd) as cost
         FROM llm_calls WHERE run_id = ?
         GROUP BY bucket, role
         ORDER BY bucket`
      )
      .all(param, param);

    const recentCalls = db
      .prepare(
        `SELECT timestamp, model, role, prompt_tokens, completion_tokens,
                cost_usd, duration_secs, response_preview, error
         FROM llm_calls WHERE run_id = ?
         ORDER BY timestamp DESC LIMIT 50`
      )
      .all(param);

    db.close();
    return NextResponse.json({ run, calls, timeline, recentCalls });
  }

  // List all runs
  const runs = db
    .prepare(
      `SELECT r.*,
              COUNT(c.id) as total_calls,
              SUM(c.prompt_tokens) as total_prompt_tokens,
              SUM(c.completion_tokens) as total_completion_tokens,
              SUM(c.cost_usd) as total_cost,
              SUM(c.duration_secs) as total_duration,
              SUM(CASE WHEN c.error IS NOT NULL THEN 1 ELSE 0 END) as total_errors
       FROM runs r
       LEFT JOIN llm_calls c ON r.run_id = c.run_id
       GROUP BY r.run_id
       ORDER BY r.started_at DESC`
    )
    .all();

  db.close();
  return NextResponse.json({ runs });
}
