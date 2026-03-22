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

function tableExists(db: Database.Database, name: string): boolean {
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?")
    .get(name) as { name: string } | undefined;
  return !!row;
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
                cost_usd, duration_secs,
                prompt_full,
                COALESCE(response_full, response_preview) as response_preview,
                error
         FROM llm_calls WHERE run_id = ?
         ORDER BY timestamp DESC LIMIT 50`
      )
      .all(param);

    // --- GEPA optimization data ---

    // Candidates (post-run)
    let candidates: unknown[] = [];
    if (tableExists(db, "gepa_candidates")) {
      candidates = db
        .prepare(
          `SELECT candidate_idx, parents, instructions, val_score, metric_calls_at_discovery
           FROM gepa_candidates WHERE run_id = ?
           ORDER BY candidate_idx`
        )
        .all(param);
    }

    // Metric call accuracy over time (real-time during run)
    // Bucket into windows of 20 calls for a smooth rolling accuracy
    let metricTimeline: unknown[] = [];
    if (tableExists(db, "gepa_metric_calls")) {
      metricTimeline = db
        .prepare(
          `SELECT
             CAST((seq - 1) / 20 AS INTEGER) * 20 + 1 as bucket_start,
             COUNT(*) as calls,
             SUM(score) as correct,
             ROUND(AVG(score), 4) as accuracy,
             MIN(timestamp) as ts_start,
             MAX(timestamp) as ts_end
           FROM gepa_metric_calls WHERE run_id = ?
           GROUP BY CAST((seq - 1) / 20 AS INTEGER)
           ORDER BY bucket_start`
        )
        .all(param);
    }

    // Per-candidate per-instance scores (for comparison)
    let candidateScores: unknown[] = [];
    if (tableExists(db, "gepa_candidate_scores")) {
      // Aggregate: for each candidate, count correct and total
      candidateScores = db
        .prepare(
          `SELECT candidate_idx,
                  COUNT(*) as evaluated,
                  SUM(CASE WHEN score >= 1.0 THEN 1 ELSE 0 END) as correct
           FROM gepa_candidate_scores WHERE run_id = ?
           GROUP BY candidate_idx
           ORDER BY candidate_idx`
        )
        .all(param);
    }

    // Pareto frontier summary
    let paretoSummary: unknown[] = [];
    if (tableExists(db, "gepa_pareto")) {
      // For each candidate on the frontier, count how many val instances it's best on
      paretoSummary = db
        .prepare(
          `SELECT value as candidate_idx, COUNT(*) as frontier_count
           FROM gepa_pareto, json_each(gepa_pareto.best_candidate_idxs)
           WHERE run_id = ?
           GROUP BY value
           ORDER BY frontier_count DESC`
        )
        .all(param);
    }

    // Recent metric calls (last 100)
    let recentMetricCalls: unknown[] = [];
    if (tableExists(db, "gepa_metric_calls")) {
      recentMetricCalls = db
        .prepare(
          `SELECT seq, problem_id, expected, predicted, score, feedback_preview
           FROM gepa_metric_calls WHERE run_id = ?
           ORDER BY seq DESC LIMIT 100`
        )
        .all(param);
    }

    // Real-time iteration data (from experiment_tracker hook)
    let iterations: unknown[] = [];
    if (tableExists(db, "gepa_iterations")) {
      iterations = db
        .prepare(
          `SELECT iteration, event, selected_candidate, subsample_score,
                  new_subsample_score, new_instructions, new_program_idx,
                  best_score, total_metric_calls, timestamp
           FROM gepa_iterations WHERE run_id = ?
           ORDER BY id ASC`
        )
        .all(param);
    }

    db.close();
    return NextResponse.json({
      run,
      calls,
      timeline,
      recentCalls,
      // GEPA optimization data
      candidates,
      metricTimeline,
      candidateScores,
      paretoSummary,
      recentMetricCalls,
      iterations,
    });
  }

  // List all runs (with GEPA stats if available)
  let runs;
  if (tableExists(db, "gepa_candidates")) {
    runs = db
      .prepare(
        `SELECT r.*,
                COUNT(DISTINCT c.id) as total_calls,
                SUM(c.prompt_tokens) as total_prompt_tokens,
                SUM(c.completion_tokens) as total_completion_tokens,
                SUM(c.cost_usd) as total_cost,
                SUM(c.duration_secs) as total_duration,
                SUM(CASE WHEN c.error IS NOT NULL THEN 1 ELSE 0 END) as total_errors,
                (SELECT COUNT(*) FROM gepa_candidates gc WHERE gc.run_id = r.run_id) as num_candidates,
                (SELECT MAX(val_score) FROM gepa_candidates gc WHERE gc.run_id = r.run_id) as best_score
         FROM runs r
         LEFT JOIN llm_calls c ON r.run_id = c.run_id
         GROUP BY r.run_id
         ORDER BY r.started_at DESC`
      )
      .all();
  } else {
    runs = db
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
  }

  db.close();
  return NextResponse.json({ runs });
}
