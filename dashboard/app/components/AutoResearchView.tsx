"use client";

import { useEffect, useState, useMemo } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Experiment {
  id: number;
  run_id: string;
  timestamp: number;
  model: string;
  cheatsheet_bytes: number;
  total_problems: number;
  accuracy: number;
  true_accuracy: number;
  false_accuracy: number;
  unparsed: number;
  total_cost_usd: number;
  total_prompt_tokens: number;
  total_completion_tokens: number;
  eval_seconds: number;
  status: string | null;
  description: string | null;
  // joined
  total_calls: number;
  calls_total_cost: number;
  avg_latency: number;
}

interface ProblemResult {
  problem_id: string;
  equation1: string;
  equation2: string;
  gold_answer: number;
  predicted_answer: number | null;
  correct: number;
  cost_usd: number;
  duration_secs: number;
  prompt_tokens: number;
  completion_tokens: number;
  response: string;
}

interface RunStats {
  total_calls: number;
  prompt_tokens: number;
  completion_tokens: number;
  total_cost: number;
  total_duration: number;
  avg_latency: number;
  correct_count: number;
  unparsed: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatTime(ts: number): string {
  return new Date(ts * 1000).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatCost(usd: number): string {
  if (!usd || usd === 0) return "$0";
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(3)}`;
}

function formatDuration(secs: number): string {
  if (!secs) return "\u2014";
  if (secs < 60) return `${secs.toFixed(1)}s`;
  return `${Math.floor(secs / 60)}m ${(secs % 60).toFixed(0)}s`;
}

function StatusBadge({ status }: { status: string | null }) {
  if (!status) return <span className="text-zinc-600 text-xs">pending</span>;
  const colors: Record<string, string> = {
    keep: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
    discard: "bg-zinc-700/40 text-zinc-400 border-zinc-600",
    error: "bg-red-500/20 text-red-400 border-red-500/30",
  };
  return (
    <span className={`px-2 py-0.5 text-xs rounded border ${colors[status] || "bg-zinc-700 text-zinc-400 border-zinc-600"}`}>
      {status}
    </span>
  );
}

function AccuracyBadge({ accuracy }: { accuracy: number }) {
  const pct = (accuracy * 100).toFixed(1);
  const color = accuracy >= 0.7 ? "text-emerald-400" : accuracy >= 0.55 ? "text-amber-400" : "text-red-400";
  return <span className={`font-mono font-semibold ${color}`}>{pct}%</span>;
}

const tooltipStyle = {
  background: "linear-gradient(180deg, #141417 0%, #111114 100%)",
  border: "1px solid #1e1e24",
  borderRadius: 8,
  color: "#fafafa",
  fontSize: 13,
};

// ---------------------------------------------------------------------------
// Run Detail View
// ---------------------------------------------------------------------------

function RunDetail({ runId, onBack }: { runId: string; onBack: () => void }) {
  const [data, setData] = useState<{
    experiment: Experiment;
    problems: ProblemResult[];
    stats: RunStats;
  } | null>(null);
  const [selectedProblem, setSelectedProblem] = useState<ProblemResult | null>(null);
  const [filterResult, setFilterResult] = useState<"all" | "correct" | "incorrect">("all");

  useEffect(() => {
    fetch(`/api/autoresearch/experiments?run_id=${runId}`)
      .then((r) => r.json())
      .then(setData);
  }, [runId]);

  if (!data) return <div className="text-zinc-500">Loading...</div>;
  const { experiment: exp, problems, stats } = data;

  const filtered = filterResult === "all"
    ? problems
    : filterResult === "correct"
      ? problems.filter((p) => p.correct)
      : problems.filter((p) => !p.correct);

  return (
    <div className="space-y-6">
      {/* Back button + header */}
      <button onClick={onBack} className="text-sm text-zinc-400 hover:text-white transition">
        &larr; Back to experiments
      </button>

      <div className="flex items-center gap-3 flex-wrap">
        <h2 className="text-lg font-semibold">Experiment {exp.run_id}</h2>
        <StatusBadge status={exp.status} />
        <AccuracyBadge accuracy={exp.accuracy} />
        <span className="text-xs text-zinc-500">{formatTime(exp.timestamp)}</span>
      </div>

      {exp.description && (
        <p className="text-sm text-zinc-400 -mt-3">{exp.description}</p>
      )}

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
        {[
          { label: "Accuracy", value: `${(exp.accuracy * 100).toFixed(1)}%` },
          { label: "TRUE Acc", value: `${(exp.true_accuracy * 100).toFixed(1)}%` },
          { label: "FALSE Acc", value: `${(exp.false_accuracy * 100).toFixed(1)}%` },
          { label: "Total Cost", value: formatCost(stats.total_cost) },
          { label: "Avg Latency", value: `${stats.avg_latency?.toFixed(1) || 0}s` },
          { label: "Sheet Size", value: `${(exp.cheatsheet_bytes / 1024).toFixed(1)} KB` },
        ].map((s) => (
          <div key={s.label} className="replay-panel p-3">
            <div className="text-[11px] font-semibold tracking-[0.08em] uppercase text-zinc-500">{s.label}</div>
            <div className="text-sm font-medium font-mono mt-1">{s.value}</div>
          </div>
        ))}
      </div>

      {/* Token & cost breakdown */}
      <div className="grid grid-cols-4 gap-3">
        {[
          { label: "LLM Calls", value: stats.total_calls?.toString() || "0" },
          { label: "Prompt Tokens", value: stats.prompt_tokens?.toLocaleString() || "0" },
          { label: "Completion Tokens", value: stats.completion_tokens?.toLocaleString() || "0" },
          { label: "Eval Duration", value: formatDuration(exp.eval_seconds) },
        ].map((s) => (
          <div key={s.label} className="replay-panel p-3">
            <div className="text-[11px] font-semibold tracking-[0.08em] uppercase text-zinc-500">{s.label}</div>
            <div className="text-sm font-medium font-mono mt-1">{s.value}</div>
          </div>
        ))}
      </div>

      {/* Per-problem results */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-[11px] font-semibold tracking-[0.08em] uppercase text-zinc-500">
            Per-Problem Results ({filtered.length})
          </h3>
          <div className="flex items-center gap-1 bg-[#0c0c0f] rounded-lg p-0.5 border border-[#1e1e24]">
            {(["all", "incorrect", "correct"] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilterResult(f)}
                className={`px-2.5 py-1 text-xs rounded-md transition-all ${
                  filterResult === f
                    ? "bg-sky-500/90 text-white"
                    : "text-zinc-500 hover:text-white hover:bg-white/[0.04]"
                }`}
              >
                {f === "all" ? `All (${problems.length})` : f === "correct" ? `Correct (${problems.filter(p => p.correct).length})` : `Wrong (${problems.filter(p => !p.correct).length})`}
              </button>
            ))}
          </div>
        </div>
        <div className="space-y-1 max-h-[500px] overflow-y-auto">
          {filtered.map((p) => (
            <div
              key={p.problem_id}
              className={`text-xs font-mono p-2.5 rounded border cursor-pointer transition-colors ${
                p.correct
                  ? "border-[#1e1e24] bg-[#0c0c0f] hover:bg-white/[0.02]"
                  : "border-red-900/40 bg-red-950/10 hover:bg-red-950/20"
              }`}
              onClick={() => setSelectedProblem(p)}
            >
              <div className="flex items-center gap-3">
                <span className={p.correct ? "text-emerald-400" : "text-red-400"}>
                  {p.correct ? "OK" : "XX"}
                </span>
                <span className="text-zinc-300">{p.problem_id}</span>
                <span className="text-zinc-600">
                  gold={p.gold_answer ? "TRUE" : "FALSE"}
                </span>
                <span className="text-zinc-600">
                  pred={p.predicted_answer === null ? "\u2014" : p.predicted_answer ? "TRUE" : "FALSE"}
                </span>
                <span className="text-zinc-600 ml-auto">
                  {p.prompt_tokens}+{p.completion_tokens} tok
                </span>
                <span className="text-zinc-600">{formatCost(p.cost_usd)}</span>
                <span className="text-zinc-600">{p.duration_secs.toFixed(1)}s</span>
              </div>
              {!p.correct && p.response && (
                <div className="text-zinc-600 mt-1 truncate pl-8">
                  {p.response.slice(0, 150)}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Response modal */}
      {selectedProblem && (
        <div
          className="fixed inset-0 bg-black/60 flex items-center justify-center z-50"
          onClick={() => setSelectedProblem(null)}
        >
          <div
            className="replay-panel p-6 max-w-3xl w-full max-h-[85vh] overflow-y-auto m-4"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex justify-between items-start mb-4">
              <div>
                <h3 className="text-base font-semibold">{selectedProblem.problem_id}</h3>
                <div className="flex items-center gap-2 mt-1 text-sm">
                  <span className={selectedProblem.correct ? "text-emerald-400" : "text-red-400"}>
                    {selectedProblem.correct ? "Correct" : "Incorrect"}
                  </span>
                  <span className="text-zinc-500">|</span>
                  <span className="text-zinc-400">
                    Gold: {selectedProblem.gold_answer ? "TRUE" : "FALSE"}
                  </span>
                  <span className="text-zinc-500">|</span>
                  <span className="text-zinc-400">
                    Predicted: {selectedProblem.predicted_answer === null ? "\u2014" : selectedProblem.predicted_answer ? "TRUE" : "FALSE"}
                  </span>
                </div>
              </div>
              <button
                onClick={() => setSelectedProblem(null)}
                className="text-zinc-500 hover:text-white text-lg px-2"
              >
                &times;
              </button>
            </div>

            {/* Stats row */}
            <div className="grid grid-cols-4 gap-3 mb-5 text-xs">
              {[
                { label: "Cost", value: formatCost(selectedProblem.cost_usd) },
                { label: "Latency", value: `${selectedProblem.duration_secs.toFixed(2)}s` },
                { label: "Prompt Tokens", value: selectedProblem.prompt_tokens.toLocaleString() },
                { label: "Completion Tokens", value: selectedProblem.completion_tokens.toLocaleString() },
              ].map((s) => (
                <div key={s.label} className="bg-[#0c0c0f] border border-[#1e1e24] rounded p-2 text-center">
                  <div className="font-mono">{s.value}</div>
                  <div className="text-zinc-500">{s.label}</div>
                </div>
              ))}
            </div>

            {/* Prompt (equations) */}
            <div className="mb-4">
              <div className="text-[11px] font-semibold tracking-[0.08em] uppercase text-zinc-500 mb-1.5">Prompt</div>
              <div className="bg-[#0c0c0f] border border-[#1e1e24] rounded-lg p-4 text-sm font-mono space-y-1.5 text-zinc-300">
                <div><span className="text-zinc-500">Equation 1:</span> {selectedProblem.equation1}</div>
                <div><span className="text-zinc-500">Equation 2:</span> {selectedProblem.equation2}</div>
                <div className="text-zinc-600 text-xs pt-1">Does Equation 1 imply Equation 2 over all magmas?</div>
              </div>
            </div>

            {/* Full LLM Response */}
            <div>
              <div className="text-[11px] font-semibold tracking-[0.08em] uppercase text-zinc-500 mb-1.5">Model Response</div>
              <div className="bg-[#0c0c0f] border border-[#1e1e24] rounded-lg p-4 text-sm font-mono whitespace-pre-wrap break-words text-zinc-300 max-h-[40vh] overflow-y-auto">
                {selectedProblem.response || "(empty response)"}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Progress Chart (shown above the experiments list)
// ---------------------------------------------------------------------------

function ProgressChart({ experiments }: { experiments: Experiment[] }) {
  const chartData = useMemo(() => {
    const sorted = [...experiments].sort((a, b) => a.timestamp - b.timestamp);
    let runningMax = 0;
    return sorted.map((exp, i) => {
      runningMax = Math.max(runningMax, exp.accuracy);
      return {
        index: i + 1,
        accuracy: +(exp.accuracy * 100).toFixed(1),
        runningMax: +(runningMax * 100).toFixed(1),
        runId: exp.run_id,
      };
    });
  }, [experiments]);

  if (chartData.length < 2) return null;

  return (
    <div className="replay-panel p-4">
      <h3 className="text-[11px] font-semibold tracking-[0.08em] uppercase text-zinc-500 mb-3">Accuracy Progress</h3>
      <ResponsiveContainer width="100%" height={180}>
        <LineChart data={chartData}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1e1e24" />
          <XAxis dataKey="index" tick={{ fill: "#52525b", fontSize: 11 }} />
          <YAxis domain={["auto", "auto"]} tick={{ fill: "#52525b", fontSize: 11 }} />
          <Tooltip contentStyle={tooltipStyle} />
          <Line type="monotone" dataKey="accuracy" stroke="#0ea5e9" strokeWidth={1.5} dot={{ r: 2.5 }} name="Accuracy %" />
          <Line type="stepAfter" dataKey="runningMax" stroke="#22c55e" strokeWidth={2} strokeDasharray="5 3" dot={false} name="Best %" />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main: Experiments List
// ---------------------------------------------------------------------------

export default function AutoResearchView() {
  const [experiments, setExperiments] = useState<Experiment[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [selectedRun, setSelectedRun] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/autoresearch/experiments")
      .then((r) => r.json())
      .then((data) => {
        if (data.error) setError(data.error);
        setExperiments(data.experiments || []);
      })
      .catch((e) => setError(e.message));
  }, []);

  // Detail view
  if (selectedRun) {
    return <RunDetail runId={selectedRun} onBack={() => setSelectedRun(null)} />;
  }

  // Empty state
  if (error || experiments.length === 0) {
    return (
      <div className="text-zinc-500 text-sm">
        <p>No autoresearch experiments yet.</p>
        <p className="text-xs mt-1 text-zinc-600">
          Run{" "}
          <code className="bg-[#0c0c0f] border border-[#1e1e24] px-1 rounded">cd autoresearch && uv run evaluate.py</code>{" "}
          to start.
        </p>
        {error && <p className="text-xs mt-1 text-zinc-700">{error}</p>}
      </div>
    );
  }

  // Summary stats
  const totalCost = experiments.reduce((s, e) => s + (e.total_cost_usd || 0), 0);
  const bestAcc = Math.max(...experiments.map((e) => e.accuracy));
  const kept = experiments.filter((e) => e.status === "keep").length;

  return (
    <div className="space-y-5">
      {/* Summary row */}
      <div className="grid grid-cols-4 gap-3">
        {[
          { label: "Experiments", value: experiments.length.toString() },
          { label: "Best Accuracy", value: `${(bestAcc * 100).toFixed(1)}%` },
          { label: "Kept", value: `${kept} / ${experiments.length}` },
          { label: "Total Cost", value: formatCost(totalCost) },
        ].map((s) => (
          <div key={s.label} className="replay-panel p-3 text-center">
            <div className="text-lg font-bold font-mono">{s.value}</div>
            <div className="text-[11px] font-semibold tracking-[0.08em] uppercase text-zinc-500 mt-0.5">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Progress chart */}
      <ProgressChart experiments={experiments} />

      {/* Experiments table */}
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left border-b border-[#1e1e24]/50">
            <th className="pb-2 text-[10px] uppercase tracking-wider text-zinc-600 font-normal">#</th>
            <th className="pb-2 text-[10px] uppercase tracking-wider text-zinc-600 font-normal">Run</th>
            <th className="pb-2 text-[10px] uppercase tracking-wider text-zinc-600 font-normal">Status</th>
            <th className="pb-2 text-right text-[10px] uppercase tracking-wider text-zinc-600 font-normal">Accuracy</th>
            <th className="pb-2 text-right text-[10px] uppercase tracking-wider text-zinc-600 font-normal">TRUE / FALSE</th>
            <th className="pb-2 text-right text-[10px] uppercase tracking-wider text-zinc-600 font-normal">Problems</th>
            <th className="pb-2 text-right text-[10px] uppercase tracking-wider text-zinc-600 font-normal">Cost</th>
            <th className="pb-2 text-right text-[10px] uppercase tracking-wider text-zinc-600 font-normal">Latency</th>
            <th className="pb-2 text-right text-[10px] uppercase tracking-wider text-zinc-600 font-normal">Sheet KB</th>
            <th className="pb-2 text-[10px] uppercase tracking-wider text-zinc-600 font-normal">Time</th>
          </tr>
        </thead>
        <tbody>
          {experiments.map((exp, i) => (
            <tr
              key={exp.run_id}
              className="border-b border-[#1e1e24]/50 hover:bg-white/[0.01] cursor-pointer transition-colors"
              onClick={() => setSelectedRun(exp.run_id)}
            >
              <td className="py-2 text-zinc-600">{experiments.length - i}</td>
              <td className="py-2">
                <div className="font-medium">{exp.description || exp.run_id}</div>
                <div className="text-xs text-zinc-600 font-mono">{exp.run_id}</div>
              </td>
              <td className="py-2"><StatusBadge status={exp.status} /></td>
              <td className="py-2 text-right"><AccuracyBadge accuracy={exp.accuracy} /></td>
              <td className="py-2 text-right text-xs font-mono text-zinc-500">
                {(exp.true_accuracy * 100).toFixed(0)}% / {(exp.false_accuracy * 100).toFixed(0)}%
              </td>
              <td className="py-2 text-right">{exp.total_problems}</td>
              <td className="py-2 text-right text-zinc-500">{formatCost(exp.total_cost_usd)}</td>
              <td className="py-2 text-right text-xs text-zinc-500">
                {exp.avg_latency ? `${exp.avg_latency.toFixed(1)}s` : "\u2014"}
              </td>
              <td className="py-2 text-right text-xs text-zinc-500">
                {(exp.cheatsheet_bytes / 1024).toFixed(1)}
              </td>
              <td className="py-2 text-xs text-zinc-500">{formatTime(exp.timestamp)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
