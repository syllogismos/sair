"use client";

import { useEffect, useState, useMemo } from "react";

interface EvalRun {
  eval_id: string;
  display_name: string | null;
  status: string;
  student_model: string;
  solver_version: string;
  benchmark_subset: string;
  problem_count: number;
  started_at: number;
  finished_at: number | null;
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
  total_cost_usd: number | null;
}

interface EvalResult {
  problem_id: string;
  equation1: string;
  equation2: string;
  expected: number;
  predicted: number | null;
  correct: number;
  response: string;
  elapsed_seconds: number;
  cost_usd: number;
  prompt_tokens: number;
  completion_tokens: number;
  error: string | null;
}

interface LlmCall {
  timestamp: number;
  model: string;
  role: string;
  prompt_tokens: number;
  completion_tokens: number;
  cost_usd: number;
  duration_secs: number;
  prompt_full: string;
  response_preview: string;
  response_full: string;
  error: string | null;
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    running: "bg-blue-500/20 text-blue-400 border-blue-500/30",
    completed: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
    failed: "bg-red-500/20 text-red-400 border-red-500/30",
    cancelled: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  };
  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded border ${colors[status] || "text-zinc-400 border-zinc-700"}`}>
      {status}
    </span>
  );
}

function formatTime(ts: number): string {
  return new Date(ts * 1000).toLocaleString();
}

function formatDuration(secs: number): string {
  if (secs < 60) return `${secs.toFixed(0)}s`;
  if (secs < 3600) return `${(secs / 60).toFixed(1)}m`;
  return `${(secs / 3600).toFixed(1)}h`;
}

// ─── LLM Call Modal ─────────────────────────────────────────────────

function LlmCallModal({ call, onClose }: { call: LlmCall; onClose: () => void }) {
  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-[#0c0c0f] border border-[#1e1e24] rounded-lg max-w-4xl w-full max-h-[85vh] overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b border-[#1e1e24]">
          <div className="flex items-center gap-3">
            <span className="text-sm font-medium">{call.model}</span>
            <span className="text-xs text-zinc-500">{call.prompt_tokens}+{call.completion_tokens} tok</span>
            <span className="text-xs text-zinc-500">${call.cost_usd?.toFixed(4)}</span>
            <span className="text-xs text-zinc-500">{call.duration_secs?.toFixed(1)}s</span>
          </div>
          <button onClick={onClose} className="text-zinc-500 hover:text-white text-lg">x</button>
        </div>
        <div className="overflow-y-auto max-h-[calc(85vh-60px)] p-4 space-y-4">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-zinc-600 mb-1">Prompt</div>
            <pre className="text-xs text-zinc-300 whitespace-pre-wrap bg-[#141417] rounded p-3 max-h-[300px] overflow-y-auto">{call.prompt_full || "(not captured)"}</pre>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-zinc-600 mb-1">Response</div>
            <pre className="text-xs text-zinc-300 whitespace-pre-wrap bg-[#141417] rounded p-3 max-h-[300px] overflow-y-auto">{call.response_full || call.response_preview || "(empty)"}</pre>
          </div>
          {call.error && (
            <div>
              <div className="text-[10px] uppercase tracking-wider text-red-600 mb-1">Error</div>
              <pre className="text-xs text-red-400 whitespace-pre-wrap bg-red-950/20 rounded p-3">{call.error}</pre>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Eval Detail ────────────────────────────────────────────────────

function EvalDetail({ evalId, onBack }: { evalId: string; onBack: () => void }) {
  const [data, setData] = useState<{
    eval: EvalRun;
    results: EvalResult[];
    llmCalls: LlmCall[];
  } | null>(null);
  const [filter, setFilter] = useState<"all" | "correct" | "wrong">("all");
  const [expectedFilter, setExpectedFilter] = useState<"all" | "true" | "false">("all");
  const [difficultyFilter, setDifficultyFilter] = useState<"all" | "normal" | "hard">("all");
  const [expandedProblem, setExpandedProblem] = useState<string | null>(null);
  const [viewCall, setViewCall] = useState<LlmCall | null>(null);

  useEffect(() => {
    let alive = true;
    const poll = () => {
      fetch(`/api/eval?eval_id=${evalId}`)
        .then((r) => r.json())
        .then((d) => {
          if (!alive) return;
          setData(d);
          if (d.eval?.status === "running") {
            setTimeout(poll, 10000);
          }
        });
    };
    poll();
    return () => { alive = false; };
  }, [evalId]);

  // Build a map from problem results to LLM calls by matching timestamps
  const problemToCall = useMemo(() => {
    if (!data) return {};
    const map: Record<string, LlmCall> = {};
    const calls = [...data.llmCalls].sort((a, b) => a.timestamp - b.timestamp);
    let callIdx = 0;
    for (const result of data.results) {
      // Match by finding the call closest to this result's problem
      // Since problems are evaluated in order, we can advance through calls
      if (callIdx < calls.length) {
        map[result.problem_id] = calls[callIdx];
        callIdx++;
      }
    }
    return map;
  }, [data]);

  const filtered = useMemo(() => {
    if (!data) return [];
    return data.results.filter((r) => {
      if (filter === "correct" && !r.correct) return false;
      if (filter === "wrong" && r.correct) return false;
      if (expectedFilter === "true" && !r.expected) return false;
      if (expectedFilter === "false" && r.expected) return false;
      if (difficultyFilter === "normal" && !r.problem_id.startsWith("normal")) return false;
      if (difficultyFilter === "hard" && r.problem_id.startsWith("normal")) return false;
      return true;
    });
  }, [data, filter, expectedFilter, difficultyFilter]);

  if (!data) return <div className="text-zinc-500">Loading...</div>;
  const { eval: evalRun, llmCalls } = data;

  return (
    <div className="space-y-6">
      <button onClick={onBack} className="text-sm text-zinc-400 hover:text-white transition">
        &larr; Back to evaluations
      </button>

      {/* Header */}
      <div className="flex items-center gap-3">
        <h2 className="text-lg font-semibold">{evalRun.display_name || evalRun.eval_id}</h2>
        <StatusBadge status={evalRun.status} />
        <span className="text-xs text-zinc-500 font-mono">{evalRun.eval_id}</span>
      </div>

      {/* Stats grid — recalculated from filtered results */}
      {(() => {
        const tp = filtered.filter((r) => r.expected && r.predicted && r.correct).length;
        const fp = filtered.filter((r) => !r.expected && r.predicted != null && r.predicted && !r.correct).length;
        const fn = filtered.filter((r) => r.expected && (r.predicted === 0 || r.predicted === null) && !r.correct).length;
        const tn = filtered.filter((r) => !r.expected && !r.predicted && r.correct).length;
        const total = filtered.length;
        const accuracy = total > 0 ? (tp + tn) / total : 0;
        const f1 = (2 * tp + fp + fn) > 0 ? (2 * tp) / (2 * tp + fp + fn) : 0;
        const totalCost = filtered.reduce((s, r) => s + (r.cost_usd || 0), 0);
        const isFiltered = filter !== "all" || expectedFilter !== "all" || difficultyFilter !== "all";

        return (
          <div className="grid grid-cols-4 sm:grid-cols-8 gap-3">
            {[
              { label: "Accuracy", value: `${(accuracy * 100).toFixed(1)}%` },
              { label: "F1", value: f1.toFixed(3) },
              { label: "TP", value: String(tp) },
              { label: "FP", value: String(fp) },
              { label: "FN", value: String(fn) },
              { label: "TN", value: String(tn) },
              { label: "Cost", value: `$${totalCost.toFixed(4)}` },
              { label: isFiltered ? "Shown" : "Total", value: `${total}` },
            ].map((s) => (
              <div key={s.label} className="replay-panel p-2.5">
                <div className="text-[9px] text-zinc-600 uppercase tracking-wider">{s.label}</div>
                <div className="text-sm font-medium mt-0.5 text-zinc-200">{s.value}</div>
              </div>
            ))}
          </div>
        );
      })()}

      {/* Filters */}
      <div className="flex items-center gap-4 flex-wrap">
        <div className="flex items-center gap-2">
          <label className="text-[10px] uppercase tracking-wider text-zinc-600">Result:</label>
          <select value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)}
            className="bg-[#0c0c0f] border border-[#1e1e24] rounded px-2 py-1 text-xs">
            <option value="all">All ({data.results.length})</option>
            <option value="correct">Correct ({data.results.filter((r) => r.correct).length})</option>
            <option value="wrong">Wrong ({data.results.filter((r) => !r.correct).length})</option>
          </select>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-[10px] uppercase tracking-wider text-zinc-600">Expected:</label>
          <select value={expectedFilter} onChange={(e) => setExpectedFilter(e.target.value as typeof expectedFilter)}
            className="bg-[#0c0c0f] border border-[#1e1e24] rounded px-2 py-1 text-xs">
            <option value="all">All</option>
            <option value="true">TRUE</option>
            <option value="false">FALSE</option>
          </select>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-[10px] uppercase tracking-wider text-zinc-600">Difficulty:</label>
          <select value={difficultyFilter} onChange={(e) => setDifficultyFilter(e.target.value as typeof difficultyFilter)}
            className="bg-[#0c0c0f] border border-[#1e1e24] rounded px-2 py-1 text-xs">
            <option value="all">All</option>
            <option value="normal">Normal</option>
            <option value="hard">Hard</option>
          </select>
        </div>
        <span className="text-xs text-zinc-600">{filtered.length} results shown</span>
      </div>

      {/* Results table */}
      <div className="replay-panel overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-[#1e1e24]/50">
                <th className="text-left px-3 py-2 text-[10px] uppercase tracking-wider text-zinc-600 font-normal">Problem</th>
                <th className="text-left px-3 py-2 text-[10px] uppercase tracking-wider text-zinc-600 font-normal">Equation 1</th>
                <th className="text-left px-3 py-2 text-[10px] uppercase tracking-wider text-zinc-600 font-normal">Equation 2</th>
                <th className="text-center px-3 py-2 text-[10px] uppercase tracking-wider text-zinc-600 font-normal">Expected</th>
                <th className="text-center px-3 py-2 text-[10px] uppercase tracking-wider text-zinc-600 font-normal">Predicted</th>
                <th className="text-center px-3 py-2 text-[10px] uppercase tracking-wider text-zinc-600 font-normal">Result</th>
                <th className="text-right px-3 py-2 text-[10px] uppercase tracking-wider text-zinc-600 font-normal">Time</th>
                <th className="text-right px-3 py-2 text-[10px] uppercase tracking-wider text-zinc-600 font-normal">Cost</th>
              </tr>
            </thead>
              {filtered.map((r, idx) => {
                const rowKey = `${r.problem_id}_${idx}`;
                const isExpanded = expandedProblem === rowKey;
                const call = problemToCall[r.problem_id];
                return (
                  <tbody key={rowKey}>
                    <tr
                      className={`border-b border-[#1e1e24]/30 cursor-pointer transition-colors hover:bg-white/[0.02] ${
                        r.correct ? "" : "bg-red-950/[0.05]"
                      }`}
                      onClick={() => setExpandedProblem(isExpanded ? null : rowKey)}
                    >
                      <td className="px-3 py-2 font-mono text-zinc-400 whitespace-nowrap">{r.problem_id}</td>
                      <td className="px-3 py-2 text-zinc-500 truncate max-w-[200px]">{r.equation1}</td>
                      <td className="px-3 py-2 text-zinc-500 truncate max-w-[200px]">{r.equation2}</td>
                      <td className="px-3 py-2 text-center">
                        <span className={r.expected ? "text-emerald-400" : "text-zinc-400"}>
                          {r.expected ? "TRUE" : "FALSE"}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-center">
                        {r.predicted != null ? (
                          <span className={r.predicted ? "text-emerald-400" : "text-zinc-400"}>
                            {r.predicted ? "TRUE" : "FALSE"}
                          </span>
                        ) : (
                          <span className="text-red-400">ERR</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-center">
                        {r.correct ? (
                          <span className="text-emerald-400 font-medium">OK</span>
                        ) : (
                          <span className="text-red-400 font-medium">WRONG</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right text-zinc-600 whitespace-nowrap">{r.elapsed_seconds?.toFixed(1)}s</td>
                      <td className="px-3 py-2 text-right text-zinc-600 whitespace-nowrap">${r.cost_usd?.toFixed(4)}</td>
                    </tr>
                    {isExpanded && (
                      <tr>
                        <td colSpan={8} className="bg-[#0c0c0f] border-b border-[#1e1e24]/50 px-4 py-3">
                          <div className="space-y-3">
                            {r.error && (
                              <div>
                                <div className="text-[10px] uppercase tracking-wider text-red-600 mb-1">Error</div>
                                <pre className="text-xs text-red-400 whitespace-pre-wrap">{r.error}</pre>
                              </div>
                            )}
                            <div>
                              <div className="text-[10px] uppercase tracking-wider text-zinc-600 mb-1">Model Response</div>
                              <pre className="text-xs text-zinc-400 whitespace-pre-wrap max-h-[400px] overflow-y-auto bg-[#141417] rounded p-3">{r.response || "(empty)"}</pre>
                            </div>
                            {call && (
                              <button
                                onClick={(e) => { e.stopPropagation(); setViewCall(call); }}
                                className="text-xs text-sky-400 hover:text-sky-300 transition"
                              >
                                View full LLM request/response ({call.prompt_tokens}+{call.completion_tokens} tok, ${call.cost_usd?.toFixed(4)})
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </tbody>
                );
              })}
          </table>
        </div>
      </div>

      {viewCall && <LlmCallModal call={viewCall} onClose={() => setViewCall(null)} />}
    </div>
  );
}

// ─── Eval List ──────────────────────────────────────────────────────

export default function EvalExplorer({
  initialEvalId,
  onNavigate,
}: {
  initialEvalId?: string;
  onNavigate?: (evalId?: string) => void;
}) {
  const [evals, setEvals] = useState<EvalRun[]>([]);
  const [selectedEval, setSelectedEval] = useState<string | null>(initialEvalId || null);

  useEffect(() => {
    setSelectedEval(initialEvalId || null);
  }, [initialEvalId]);

  useEffect(() => {
    fetch("/api/eval")
      .then((r) => r.json())
      .then((data) => setEvals(data.evals || []));
  }, []);

  const handleSelect = (evalId: string) => {
    setSelectedEval(evalId);
    onNavigate?.(evalId);
  };

  const handleBack = () => {
    setSelectedEval(null);
    onNavigate?.();
  };

  if (selectedEval) {
    return <EvalDetail evalId={selectedEval} onBack={handleBack} />;
  }

  return (
    <div className="space-y-6">
      <div className="replay-panel overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#1e1e24]/50">
                <th className="text-left px-4 py-3 text-[10px] uppercase tracking-wider text-zinc-600 font-normal">Name</th>
                <th className="text-left px-4 py-3 text-[10px] uppercase tracking-wider text-zinc-600 font-normal">Subset</th>
                <th className="text-center px-4 py-3 text-[10px] uppercase tracking-wider text-zinc-600 font-normal">Status</th>
                <th className="text-right px-4 py-3 text-[10px] uppercase tracking-wider text-zinc-600 font-normal">Accuracy</th>
                <th className="text-right px-4 py-3 text-[10px] uppercase tracking-wider text-zinc-600 font-normal">F1</th>
                <th className="text-right px-4 py-3 text-[10px] uppercase tracking-wider text-zinc-600 font-normal">Problems</th>
                <th className="text-right px-4 py-3 text-[10px] uppercase tracking-wider text-zinc-600 font-normal">Cost</th>
                <th className="text-right px-4 py-3 text-[10px] uppercase tracking-wider text-zinc-600 font-normal">Started</th>
              </tr>
            </thead>
            <tbody>
              {evals.map((e) => (
                <tr
                  key={e.eval_id}
                  onClick={() => handleSelect(e.eval_id)}
                  className="border-b border-[#1e1e24]/50 hover:bg-white/[0.02] cursor-pointer transition-colors"
                >
                  <td className="px-4 py-2.5 font-medium">
                    {e.display_name || e.eval_id}
                    <span className="text-xs text-zinc-600 font-mono ml-2">{e.eval_id}</span>
                  </td>
                  <td className="px-4 py-2.5 text-zinc-400">{e.benchmark_subset}</td>
                  <td className="px-4 py-2.5 text-center"><StatusBadge status={e.status} /></td>
                  <td className="px-4 py-2.5 text-right font-mono">
                    {e.accuracy != null ? (
                      <span className={e.accuracy >= 0.7 ? "text-emerald-400" : e.accuracy >= 0.55 ? "text-yellow-400" : "text-red-400"}>
                        {(e.accuracy * 100).toFixed(1)}%
                      </span>
                    ) : "-"}
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono">
                    {e.f1_score != null ? e.f1_score.toFixed(3) : "-"}
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono text-zinc-400">{e.problem_count}</td>
                  <td className="px-4 py-2.5 text-right font-mono text-zinc-500">
                    {e.total_cost_usd != null ? `$${e.total_cost_usd.toFixed(4)}` : "-"}
                  </td>
                  <td className="px-4 py-2.5 text-right text-zinc-500 text-xs">
                    {e.started_at ? formatTime(e.started_at) : "-"}
                  </td>
                </tr>
              ))}
              {evals.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-zinc-600">
                    No evaluation runs yet. Run one with: uv run python src/run_eval.py --solver-path submission.txt --subset all_400
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
