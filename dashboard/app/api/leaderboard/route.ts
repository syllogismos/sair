import { NextResponse } from "next/server";
import Database from "better-sqlite3";
import path from "path";
import { readFileSync } from "fs";

const GEPA_DB_PATH = path.resolve(process.cwd(), "..", "gepa_observations.db");

interface EvalRun {
  eval_id: string;
  gepa_run_id: string | null;
  solver_version: string;
  student_model: string;
  benchmark_subset: string;
  problem_count: number;
  accuracy: number | null;
  f1_score: number | null;
  tp: number;
  fp: number;
  fn: number;
  tn: number;
  unparsed: number;
  parse_success_rate: number | null;
  avg_cost_usd: number | null;
  avg_time_secs: number | null;
  display_name: string | null;
  status: string;
}

// Map our subset names to benchmark_ids
const SUBSET_TO_BENCHMARK: Record<string, string[]> = {
  normal_200: ["normal_200_common_25_low_reason"],
  hard_200: ["hard_200_common_25_low_reason"],
  all_400: ["normal_200_common_25_low_reason", "hard_200_common_25_low_reason"],
};

export async function GET() {
  // Load benchmark data from static JSON
  let benchmarkLeaderboard: unknown[] = [];
  let benchmarkModels: unknown[] = [];
  try {
    const lbPath = path.resolve(process.cwd(), "public", "data", "leaderboard.json");
    const mdPath = path.resolve(process.cwd(), "public", "data", "models.json");
    benchmarkLeaderboard = JSON.parse(readFileSync(lbPath, "utf-8"));
    benchmarkModels = JSON.parse(readFileSync(mdPath, "utf-8"));
  } catch {
    // Static files missing — return empty benchmark data
  }

  // Load our eval runs from gepa_observations.db
  const ourLeaderboard: unknown[] = [];
  const ourModels: unknown[] = [];
  try {
    const db = new Database(GEPA_DB_PATH, { readonly: true });

    // Check if eval_runs table exists
    const tableCheck = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='eval_runs'")
      .get() as { name: string } | undefined;

    if (tableCheck) {
      const evalRuns = db
        .prepare("SELECT * FROM eval_runs WHERE status = 'completed' AND accuracy IS NOT NULL")
        .all() as EvalRun[];

      for (const run of evalRuns) {
        const modelId = `ours/${run.eval_id}`;
        const displayName = run.display_name || `[OURS] ${run.eval_id}`;

        // Add model entry
        ourModels.push({
          model_id: modelId,
          display_name: displayName,
          provider: "ours",
          family: "gepa",
        });

        // Figure out which benchmark(s) this maps to
        const benchmarkIds = SUBSET_TO_BENCHMARK[run.benchmark_subset];
        if (!benchmarkIds) continue;

        for (const benchmarkId of benchmarkIds) {
          // For all_400, split metrics between normal and hard based on problem prefix
          // For single-subset runs, use metrics as-is
          if (run.benchmark_subset === "all_400" && benchmarkIds.length > 1) {
            // Need to compute per-subset metrics from eval_results
            const subsetPrefix = benchmarkId.startsWith("normal") ? "normal" : "hard";
            const results = db
              .prepare(`
                SELECT
                  COUNT(*) as total,
                  SUM(CASE WHEN correct = 1 THEN 1 ELSE 0 END) as correct_count,
                  SUM(CASE WHEN expected = 1 AND predicted = 1 THEN 1 ELSE 0 END) as tp,
                  SUM(CASE WHEN expected = 0 AND predicted = 1 THEN 1 ELSE 0 END) as fp,
                  SUM(CASE WHEN expected = 1 AND (predicted = 0 OR predicted IS NULL) THEN 1 ELSE 0 END) as fn,
                  SUM(CASE WHEN expected = 0 AND predicted = 0 THEN 1 ELSE 0 END) as tn,
                  SUM(CASE WHEN predicted IS NULL AND error IS NOT NULL THEN 1 ELSE 0 END) as unparsed,
                  AVG(cost_usd) as avg_cost,
                  AVG(elapsed_seconds) as avg_time
                FROM eval_results
                WHERE eval_id = ? AND problem_id LIKE ?
              `)
              .get(run.eval_id, `${subsetPrefix}%`) as {
                total: number; correct_count: number;
                tp: number; fp: number; fn: number; tn: number; unparsed: number;
                avg_cost: number | null; avg_time: number | null;
              } | undefined;

            if (!results || results.total === 0) continue;

            const subAcc = results.correct_count / results.total;
            const subF1 = (2 * results.tp) / (2 * results.tp + results.fp + results.fn) || 0;
            const subParse = (results.total - results.unparsed) / results.total;

            ourLeaderboard.push({
              benchmark_id: benchmarkId,
              model_id: modelId,
              accuracy: subAcc,
              f1_score: subF1,
              tp: results.tp,
              fp: results.fp,
              fn: results.fn,
              tn: results.tn,
              unparsed: results.unparsed,
              parse_success_rate: subParse,
              avg_cost_usd: results.avg_cost || 0,
              avg_time_secs: results.avg_time || 0,
              repeat_consistency: 1.0,
              run_count: results.total,
              problem_count: results.total,
              repeat_count: 1,
            });
          } else {
            ourLeaderboard.push({
              benchmark_id: benchmarkId,
              model_id: modelId,
              accuracy: run.accuracy,
              f1_score: run.f1_score,
              tp: run.tp,
              fp: run.fp,
              fn: run.fn,
              tn: run.tn,
              unparsed: run.unparsed,
              parse_success_rate: run.parse_success_rate,
              avg_cost_usd: run.avg_cost_usd || 0,
              avg_time_secs: run.avg_time_secs || 0,
              repeat_consistency: 1.0,
              run_count: run.problem_count,
              problem_count: run.problem_count,
              repeat_count: 1,
            });
          }
        }
      }
    }
    db.close();
  } catch {
    // gepa_observations.db missing or error — just return benchmark data
  }

  return NextResponse.json({
    leaderboard: [...benchmarkLeaderboard, ...ourLeaderboard],
    models: [...benchmarkModels, ...ourModels],
  });
}
