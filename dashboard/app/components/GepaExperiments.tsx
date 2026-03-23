"use client";

import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";

interface Run {
  run_id: string;
  name: string;
  solver: string;
  auto: string;
  started_at: number;
  finished_at: number | null;
  status: string;
  total_calls: number;
  total_prompt_tokens: number;
  total_completion_tokens: number;
  total_cost: number;
  total_duration: number;
  total_errors: number;
  num_candidates?: number;
  best_score?: number;
}

interface CallGroup {
  model: string;
  role: string;
  calls: number;
  prompt_tokens: number;
  completion_tokens: number;
  cost_usd: number;
  duration_secs: number;
  errors: number;
}

interface RecentCall {
  timestamp: number;
  model: string;
  role: string;
  prompt_tokens: number;
  completion_tokens: number;
  cost_usd: number;
  duration_secs: number;
  prompt_full: string | null;
  response_preview: string | null;
  error: string | null;
}

interface Candidate {
  candidate_idx: number;
  parents: string; // JSON
  instructions: string; // JSON
  val_score: number;
  metric_calls_at_discovery: number;
}

interface MetricBucket {
  bucket_start: number;
  calls: number;
  correct: number;
  accuracy: number;
}

interface ParetoEntry {
  candidate_idx: number;
  frontier_count: number;
}

interface MetricCall {
  seq: number;
  problem_id: string;
  expected: number;
  predicted: number;
  score: number;
  feedback_preview: string;
}

interface Iteration {
  iteration: number;
  event: string;
  selected_candidate: number | null;
  subsample_score: number | null;
  new_subsample_score: number | null;
  new_instructions: string | null; // JSON
  new_program_idx: number | null;
  best_score: number | null;
  total_metric_calls: number | null;
  timestamp: number;
}

function formatTime(ts: number): string {
  return new Date(ts * 1000).toLocaleString();
}

function formatDuration(secs: number): string {
  if (secs < 60) return `${secs.toFixed(1)}s`;
  return `${Math.floor(secs / 60)}m ${(secs % 60).toFixed(0)}s`;
}

function formatCost(usd: number): string {
  if (usd < 0.01) return `$${(usd * 100).toFixed(2)}¢`;
  return `$${usd.toFixed(4)}`;
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    running: "bg-blue-500/20 text-blue-400 border-blue-500/30",
    completed: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
    failed: "bg-red-500/20 text-red-400 border-red-500/30",
    cancelled: "bg-amber-500/20 text-amber-400 border-amber-500/30",
  };
  return (
    <span
      className={`px-2 py-0.5 text-xs rounded border ${colors[status] || "bg-zinc-700 text-zinc-400 border-zinc-600"}`}
    >
      {status}
    </span>
  );
}

function ResponseModal({
  call,
  onClose,
}: {
  call: RecentCall;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-6"
      onClick={onClose}
    >
      <div
        className="bg-[#18181b] border border-[#27272a] rounded-xl max-w-3xl w-full max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#27272a]">
          <div>
            <h3 className="text-sm font-medium">
              <span
                className={
                  call.role === "reflection"
                    ? "text-purple-400"
                    : "text-cyan-400"
                }
              >
                {call.role}
              </span>{" "}
              — {call.model}
            </h3>
            <p className="text-xs text-zinc-500 mt-0.5">
              {new Date(call.timestamp * 1000).toLocaleString()} |{" "}
              {call.duration_secs?.toFixed(1)}s | {formatCost(call.cost_usd || 0)} |{" "}
              {call.prompt_tokens}+{call.completion_tokens} tok
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-zinc-400 hover:text-white px-2 py-1"
          >
            Close
          </button>
        </div>
        {call.error && (
          <div className="px-6 py-3 bg-red-950/20 border-b border-red-900/30">
            <div className="text-xs text-red-400 font-mono">{call.error}</div>
          </div>
        )}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {call.prompt_full && (
            <div>
              <div className="text-xs text-zinc-500 mb-1">Prompt</div>
              <pre className="text-xs text-zinc-400 bg-[#09090b] rounded-lg p-4 border border-[#27272a] whitespace-pre-wrap break-words max-h-[30vh] overflow-y-auto">
                {call.prompt_full}
              </pre>
            </div>
          )}
          <div>
            <div className="text-xs text-zinc-500 mb-1">Response</div>
            <div className="text-sm bg-[#09090b] rounded-lg p-4 border border-[#27272a] prose prose-invert prose-sm max-w-none [&_.katex]:text-[#e2e8f0] [&_p]:text-[#d4d4d8] [&_li]:text-[#d4d4d8] [&_code]:text-[#a78bfa] [&_code]:bg-[#27272a] [&_code]:px-1 [&_code]:rounded">
              {call.response_preview ? (
                <ReactMarkdown
                  remarkPlugins={[remarkMath]}
                  rehypePlugins={[rehypeKatex]}
                >
                  {call.response_preview.replace(/\n/g, "  \n")}
                </ReactMarkdown>
              ) : (
                <span className="text-zinc-500">(no response recorded)</span>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// --- GEPA-specific components ---

function AccuracyChart({ data }: { data: MetricBucket[] }) {
  const [hovered, setHovered] = useState<number | null>(null);

  if (data.length === 0) return null;

  const W = 700;
  const H = 200;
  const PAD = { top: 20, right: 20, bottom: 30, left: 45 };
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;

  const maxX = data[data.length - 1].bucket_start + 20;
  const xScale = (v: number) => PAD.left + (v / maxX) * plotW;
  const yScale = (v: number) => PAD.top + plotH - v * plotH;

  const points = data.map(
    (d) => `${xScale(d.bucket_start)},${yScale(d.accuracy)}`
  );
  const polyline = points.join(" ");

  const areaPath = [
    `M ${xScale(data[0].bucket_start)},${yScale(0)}`,
    ...data.map((d) => `L ${xScale(d.bucket_start)},${yScale(d.accuracy)}`),
    `L ${xScale(data[data.length - 1].bucket_start)},${yScale(0)}`,
    "Z",
  ].join(" ");

  const yTicks = [0, 0.25, 0.5, 0.75, 1.0];
  const hoveredData = hovered !== null ? data[hovered] : null;

  return (
    <div>
      <h3 className="text-sm font-medium text-zinc-400 mb-2">
        Evaluation Accuracy Over Time
      </h3>
      <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-3 relative">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ maxHeight: 220 }}>
          {yTicks.map((t) => (
            <g key={t}>
              <line
                x1={PAD.left} y1={yScale(t)}
                x2={W - PAD.right} y2={yScale(t)}
                stroke="#27272a" strokeWidth={1}
              />
              <text
                x={PAD.left - 6} y={yScale(t) + 4}
                textAnchor="end" className="fill-zinc-500" fontSize={10}
              >
                {(t * 100).toFixed(0)}%
              </text>
            </g>
          ))}

          <text
            x={PAD.left + plotW / 2} y={H - 4}
            textAnchor="middle" className="fill-zinc-500" fontSize={10}
          >
            Metric calls
          </text>

          <path d={areaPath} fill="url(#accuracyGrad)" opacity={0.3} />

          <polyline
            points={polyline} fill="none"
            stroke="#6366f1" strokeWidth={2} strokeLinejoin="round"
          />

          {/* Hover targets — larger invisible circles for easier hovering */}
          {data.map((d, i) => (
            <circle
              key={`hover-${i}`}
              cx={xScale(d.bucket_start)}
              cy={yScale(d.accuracy)}
              r={12}
              fill="transparent"
              onMouseEnter={() => setHovered(i)}
              onMouseLeave={() => setHovered(null)}
              className="cursor-pointer"
            />
          ))}

          {/* Visible dots */}
          {data.map((d, i) => (
            <circle
              key={i}
              cx={xScale(d.bucket_start)}
              cy={yScale(d.accuracy)}
              r={hovered === i ? 5 : 3}
              fill={hovered === i ? "#818cf8" : "#6366f1"}
              stroke="#09090b"
              strokeWidth={1}
              className="pointer-events-none"
            />
          ))}

          {/* Hover crosshair */}
          {hoveredData && (
            <line
              x1={xScale(hoveredData.bucket_start)}
              y1={PAD.top}
              x2={xScale(hoveredData.bucket_start)}
              y2={PAD.top + plotH}
              stroke="#6366f1"
              strokeWidth={1}
              strokeDasharray="3,3"
              opacity={0.4}
              className="pointer-events-none"
            />
          )}

          <defs>
            <linearGradient id="accuracyGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#6366f1" stopOpacity={0.4} />
              <stop offset="100%" stopColor="#6366f1" stopOpacity={0} />
            </linearGradient>
          </defs>
        </svg>

        {/* Hover tooltip */}
        {hoveredData && (
          <div className="absolute top-2 right-3 bg-[#09090b] border border-zinc-700 rounded-lg px-3 py-2 text-xs pointer-events-none">
            <div className="text-zinc-400">
              Calls {hoveredData.bucket_start}–{hoveredData.bucket_start + 19}
            </div>
            <div className="text-indigo-400 font-medium text-sm">
              {(hoveredData.accuracy * 100).toFixed(1)}%
            </div>
            <div className="text-zinc-500">
              {hoveredData.correct}/{hoveredData.calls} correct
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function CandidatesTable({
  candidates,
  paretoSummary,
}: {
  candidates: Candidate[];
  paretoSummary: ParetoEntry[];
}) {
  const [expanded, setExpanded] = useState<number | null>(null);

  if (candidates.length === 0) {
    return (
      <div className="text-zinc-500 text-sm">
        No candidate data yet. Candidates appear after the run completes.
      </div>
    );
  }

  const paretoMap = new Map(
    paretoSummary.map((p) => [p.candidate_idx, p.frontier_count])
  );
  const bestIdx = candidates.reduce(
    (best, c) => (c.val_score > (candidates[best]?.val_score ?? -1) ? c.candidate_idx : best),
    0
  );

  return (
    <div>
      <h3 className="text-sm font-medium text-zinc-400 mb-2">
        Candidate Programs ({candidates.length})
      </h3>
      <div className="space-y-1">
        {candidates.map((c) => {
          const parents = JSON.parse(c.parents || "[]");
          const instructions = JSON.parse(c.instructions || "{}");
          const isExpanded = expanded === c.candidate_idx;
          const isBest = c.candidate_idx === bestIdx;
          const frontierCount = paretoMap.get(c.candidate_idx) || 0;

          return (
            <div
              key={c.candidate_idx}
              className={`border rounded-lg transition-colors ${
                isBest
                  ? "border-indigo-500/40 bg-indigo-950/20"
                  : "border-zinc-800 bg-zinc-900"
              }`}
            >
              <div
                className="flex items-center gap-3 px-4 py-2.5 cursor-pointer hover:bg-zinc-800/50 transition-colors"
                onClick={() =>
                  setExpanded(isExpanded ? null : c.candidate_idx)
                }
              >
                <span className="text-xs font-mono text-zinc-500 w-6">
                  #{c.candidate_idx}
                </span>

                {/* Score bar */}
                <div className="flex items-center gap-2 w-32">
                  <div className="flex-1 h-2 bg-zinc-800 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full ${
                        isBest ? "bg-indigo-500" : "bg-zinc-600"
                      }`}
                      style={{ width: `${(c.val_score * 100).toFixed(1)}%` }}
                    />
                  </div>
                  <span
                    className={`text-xs font-mono ${
                      isBest ? "text-indigo-400 font-medium" : "text-zinc-400"
                    }`}
                  >
                    {(c.val_score * 100).toFixed(1)}%
                  </span>
                </div>

                {/* Lineage */}
                <span className="text-xs text-zinc-600">
                  {parents[0] === null
                    ? "seed"
                    : `from #${parents.filter((p: unknown) => p !== null).join(", #")}`}
                </span>

                {/* Budget */}
                <span className="text-xs text-zinc-600 ml-auto">
                  @{c.metric_calls_at_discovery} calls
                </span>

                {/* Pareto badge */}
                {frontierCount > 0 && (
                  <span className="text-xs px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-400 border border-amber-500/20">
                    Pareto ({frontierCount})
                  </span>
                )}

                {isBest && (
                  <span className="text-xs px-1.5 py-0.5 rounded bg-indigo-500/20 text-indigo-400 border border-indigo-500/30">
                    Best
                  </span>
                )}

                <span className="text-zinc-600 text-xs">
                  {isExpanded ? "▲" : "▼"}
                </span>
              </div>

              {isExpanded && (
                <div className="px-4 pb-3 border-t border-zinc-800/50">
                  {Object.entries(instructions).map(([name, text]) => (
                    <div key={name} className="mt-2">
                      <div className="text-xs text-zinc-500 mb-1">
                        {name}
                      </div>
                      <pre className="text-xs text-zinc-300 bg-[#09090b] rounded-lg p-3 border border-zinc-800 whitespace-pre-wrap break-words max-h-64 overflow-y-auto">
                        {text as string}
                      </pre>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ParetoSummary({ data }: { data: ParetoEntry[] }) {
  if (data.length === 0) return null;

  const counts = data.map((d) => d.frontier_count);
  const maxCount = Math.max(...counts);
  const totalExamples = counts.reduce((s, c) => s + c, 0);

  return (
    <div>
      <h3 className="text-sm font-medium text-zinc-400 mb-2">
        Pareto Frontier
      </h3>
      <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-zinc-500 border-b border-zinc-800">
              <th className="pb-2 pr-4">Candidate</th>
              <th className="pb-2 text-right">Best on</th>
              <th className="pb-2 pl-4">Coverage</th>
            </tr>
          </thead>
          <tbody>
            {data.map((d) => (
              <tr key={d.candidate_idx} className="border-b border-zinc-800/50">
                <td className="py-1.5 pr-4 font-mono text-zinc-300">
                  #{d.candidate_idx}
                </td>
                <td className="py-1.5 text-right text-zinc-400">
                  {d.frontier_count} / {totalExamples}
                </td>
                <td className="py-1.5 pl-4">
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-2 bg-zinc-800 rounded-full overflow-hidden max-w-[200px]">
                      <div
                        className="h-full rounded-full bg-amber-500/50"
                        style={{ width: `${(d.frontier_count / maxCount) * 100}%` }}
                      />
                    </div>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="text-xs text-zinc-600 mt-2">
          Each candidate is best on different validation examples — no single prompt solves everything
        </div>
      </div>
    </div>
  );
}

function RecentMetricCalls({ data }: { data: MetricCall[] }) {
  const [selected, setSelected] = useState<MetricCall | null>(null);

  if (data.length === 0) return null;

  const reversed = [...data].reverse();

  return (
    <div>
      <h3 className="text-sm font-medium text-zinc-400 mb-2">
        Recent Metric Evaluations (last 100)
      </h3>
      <div className="flex flex-wrap gap-[2px]">
        {reversed.map((d) => (
          <div
            key={d.seq}
            onClick={() => setSelected(selected?.seq === d.seq ? null : d)}
            className={`w-3 h-3 rounded-[2px] cursor-pointer transition-all ${
              d.score >= 1.0
                ? "bg-emerald-500/60 hover:bg-emerald-400"
                : "bg-red-500/40 hover:bg-red-400"
            } ${selected?.seq === d.seq ? "ring-1 ring-white" : ""}`}
            title={`#${d.seq} ${d.problem_id}`}
          />
        ))}
      </div>
      <div className="flex items-center gap-4 mt-2 text-xs text-zinc-600">
        <span className="flex items-center gap-1">
          <span className="w-2.5 h-2.5 rounded-[2px] bg-emerald-500/60 inline-block" /> Correct
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2.5 h-2.5 rounded-[2px] bg-red-500/40 inline-block" /> Wrong
        </span>
        <span>
          {data.filter((d) => d.score >= 1.0).length}/{data.length} in last batch
        </span>
      </div>

      {selected && (
        <div className="mt-3 bg-[#09090b] border border-zinc-800 rounded-lg p-4 text-sm">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-3">
              <span className={`px-2 py-0.5 text-xs rounded border ${
                selected.score >= 1.0
                  ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/30"
                  : "bg-red-500/20 text-red-400 border-red-500/30"
              }`}>
                {selected.score >= 1.0 ? "Correct" : "Wrong"}
              </span>
              <span className="text-xs font-mono text-zinc-400">
                #{selected.seq}
              </span>
              <span className="text-xs text-zinc-500">
                {selected.problem_id}
              </span>
            </div>
            <button
              onClick={() => setSelected(null)}
              className="text-zinc-500 hover:text-white text-xs"
            >
              Close
            </button>
          </div>
          <div className="grid grid-cols-2 gap-4 mb-3">
            <div>
              <div className="text-xs text-zinc-500 mb-1">Expected</div>
              <div className={`text-sm font-mono ${selected.expected ? "text-emerald-400" : "text-red-400"}`}>
                {selected.expected ? "TRUE" : "FALSE"}
              </div>
            </div>
            <div>
              <div className="text-xs text-zinc-500 mb-1">Predicted</div>
              <div className={`text-sm font-mono ${
                selected.predicted === selected.expected
                  ? "text-emerald-400"
                  : "text-red-400"
              }`}>
                {selected.predicted ? "TRUE" : "FALSE"}
              </div>
            </div>
          </div>
          {selected.feedback_preview && (
            <div>
              <div className="text-xs text-zinc-500 mb-1">Feedback</div>
              <pre className="text-xs text-zinc-300 bg-zinc-900 rounded-lg p-3 border border-zinc-800 whitespace-pre-wrap break-words max-h-48 overflow-y-auto">
                {selected.feedback_preview}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function LiveCandidates({ iterations }: { iterations: Iteration[] }) {
  const [expanded, setExpanded] = useState<number | null>(null);

  // Build candidates from accepted iterations
  const liveCandidates: {
    idx: number;
    parentIdx: number | null;
    instructions: Record<string, string>;
    bestScore: number | null;
    metricCalls: number | null;
    iteration: number;
  }[] = [];

  // Seed candidate — get instruction from seed_instruction event, score from base_eval
  const baseEvt = iterations.find((it) => it.event === "base_eval");
  const seedEvt = iterations.find((it) => it.event === "seed_instruction");
  if (baseEvt || seedEvt) {
    const seedInstructions = seedEvt?.new_instructions
      ? JSON.parse(seedEvt.new_instructions)
      : {};
    liveCandidates.push({
      idx: 0,
      parentIdx: null,
      instructions: seedInstructions,
      bestScore: baseEvt?.best_score ?? null,
      metricCalls: baseEvt?.total_metric_calls ?? null,
      iteration: baseEvt?.iteration ?? 0,
    });
  }

  // Accepted candidates — gather proposal + acceptance from same iteration
  const byIteration = new Map<number, Iteration[]>();
  for (const it of iterations) {
    if (it.iteration == null) continue;
    const group = byIteration.get(it.iteration) || [];
    group.push(it);
    byIteration.set(it.iteration, group);
  }

  for (const [iterNum, events] of byIteration) {
    const acceptedEvt = events.find((e) => e.event === "candidate_accepted");
    if (!acceptedEvt || acceptedEvt.new_program_idx == null) continue;

    const proposalEvt = events.find((e) => e.event === "proposal");
    const selectEvt = events.find((e) => e.event === "select_parent");
    const instructions = proposalEvt?.new_instructions
      ? JSON.parse(proposalEvt.new_instructions)
      : {};

    liveCandidates.push({
      idx: acceptedEvt.new_program_idx,
      parentIdx: selectEvt?.selected_candidate ?? null,
      instructions,
      bestScore: acceptedEvt.best_score,
      metricCalls: acceptedEvt.total_metric_calls,
      iteration: iterNum,
    });
  }

  if (liveCandidates.length === 0) return null;

  const bestIdx = liveCandidates.reduce(
    (best, c) =>
      (c.bestScore ?? -1) > (liveCandidates[best]?.bestScore ?? -1)
        ? liveCandidates.indexOf(c)
        : best,
    0
  );

  return (
    <div>
      <h3 className="text-sm font-medium text-zinc-400 mb-2">
        Candidate Programs (live — {liveCandidates.length} so far)
      </h3>
      <div className="space-y-1">
        {liveCandidates.map((c, i) => {
          const isExpanded = expanded === c.idx;
          const isBest = i === bestIdx;
          const hasInstructions = Object.keys(c.instructions).length > 0;

          return (
            <div
              key={c.idx}
              className={`border rounded-lg transition-colors ${
                isBest
                  ? "border-indigo-500/40 bg-indigo-950/20"
                  : "border-zinc-800 bg-zinc-900"
              }`}
            >
              <div
                className={`flex items-center gap-3 px-4 py-2.5 ${
                  hasInstructions
                    ? "cursor-pointer hover:bg-zinc-800/50"
                    : ""
                } transition-colors`}
                onClick={() =>
                  hasInstructions &&
                  setExpanded(isExpanded ? null : c.idx)
                }
              >
                <span className="text-xs font-mono text-zinc-500 w-6">
                  #{c.idx}
                </span>

                {c.bestScore != null && (
                  <div className="flex items-center gap-2 w-32">
                    <div className="flex-1 h-2 bg-zinc-800 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full ${
                          isBest ? "bg-indigo-500" : "bg-zinc-600"
                        }`}
                        style={{
                          width: `${(c.bestScore * 100).toFixed(1)}%`,
                        }}
                      />
                    </div>
                    <span
                      className={`text-xs font-mono ${
                        isBest
                          ? "text-indigo-400 font-medium"
                          : "text-zinc-400"
                      }`}
                    >
                      {(c.bestScore * 100).toFixed(1)}%
                    </span>
                  </div>
                )}

                <span className="text-xs text-zinc-600">
                  {c.parentIdx === null
                    ? "seed"
                    : `from #${c.parentIdx}`}
                </span>

                <span className="text-xs text-zinc-600">
                  iter {c.iteration}
                </span>

                {c.metricCalls != null && (
                  <span className="text-xs text-zinc-600 ml-auto">
                    @{c.metricCalls} calls
                  </span>
                )}

                {isBest && (
                  <span className="text-xs px-1.5 py-0.5 rounded bg-indigo-500/20 text-indigo-400 border border-indigo-500/30">
                    Best
                  </span>
                )}

                {hasInstructions && (
                  <span className="text-zinc-600 text-xs">
                    {isExpanded ? "▲" : "▼"}
                  </span>
                )}
              </div>

              {isExpanded && hasInstructions && (
                <div className="px-4 pb-3 border-t border-zinc-800/50">
                  {Object.entries(c.instructions).map(([name, text]) => (
                    <div key={name} className="mt-2">
                      <div className="text-xs text-zinc-500 mb-1">
                        {name}
                      </div>
                      <pre className="text-xs text-zinc-300 bg-[#09090b] rounded-lg p-3 border border-zinc-800 whitespace-pre-wrap break-words max-h-64 overflow-y-auto">
                        {text}
                      </pre>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function IterationsTimeline({ iterations, totalMetricCalls }: { iterations: Iteration[]; totalMetricCalls: number; }) {
  // Infer valset size from base_eval — it consumes exactly valset_size metric calls
  const baseEvtCalls = iterations.find((it) => it.event === "base_eval")?.total_metric_calls;
  const valsetSize = baseEvtCalls || null;
  if (iterations.length === 0) return null;

  // Group by iteration number
  const byIteration = new Map<number, Iteration[]>();
  for (const it of iterations) {
    if (it.iteration == null) continue;
    const group = byIteration.get(it.iteration) || [];
    group.push(it);
    byIteration.set(it.iteration, group);
  }

  const [expandedInstr, setExpandedInstr] = useState<number | null>(null);

  return (
    <div>
      <h3 className="text-sm font-medium text-zinc-400 mb-2">
        GEPA Iterations (live)
      </h3>
      <div className="space-y-2 max-h-[600px] overflow-y-auto">
        {[...byIteration.entries()].map(([iterNum, events]) => {
          const selectEvt = events.find((e) => e.event === "select_parent");
          const proposalEvt = events.find((e) => e.event === "proposal");
          const beforeEvt = events.find((e) => e.event === "subsample_before");
          const afterEvt = events.find((e) => e.event === "subsample_eval");
          const acceptedEvt = events.find((e) => e.event === "candidate_accepted");
          const baseEvt = events.find((e) => e.event === "base_eval");

          if (baseEvt) {
            return (
              <div
                key={iterNum}
                className="border border-zinc-800 rounded-lg p-3 bg-zinc-900"
              >
                <div className="flex items-center gap-2">
                  <span className="text-xs font-mono text-zinc-500">
                    iter {iterNum}
                  </span>
                  <span className="text-xs px-1.5 py-0.5 rounded bg-zinc-700 text-zinc-300">
                    Base evaluation
                  </span>
                  {baseEvt.best_score != null && (
                    <span className="text-xs text-zinc-400 ml-auto">
                      score: {((baseEvt.best_score) * 100).toFixed(1)}%
                    </span>
                  )}
                </div>
              </div>
            );
          }

          const wasAccepted = !!acceptedEvt;
          const improved = !!afterEvt && !!beforeEvt &&
            (afterEvt.new_subsample_score ?? 0) > (beforeEvt.subsample_score ?? 0);
          const wasRejected = !wasAccepted && !!afterEvt && !improved;
          const isEvaluating = !wasAccepted && !!afterEvt && improved;
          const wasSkipped = !afterEvt && !wasAccepted && !beforeEvt;
          const instructions = proposalEvt?.new_instructions
            ? JSON.parse(proposalEvt.new_instructions)
            : null;
          const hasInstructions =
            instructions && Object.keys(instructions).length > 0;
          const isExpanded = expandedInstr === iterNum;

          return (
            <div
              key={iterNum}
              className={`border rounded-lg overflow-hidden ${
                wasAccepted
                  ? "border-emerald-500/30 bg-emerald-950/10"
                  : wasRejected
                    ? "border-zinc-800 bg-zinc-900"
                    : "border-zinc-800/50 bg-zinc-900/50"
              }`}
            >
              {/* Header — always visible */}
              <div
                className={`flex items-center gap-2 flex-wrap p-3 ${
                  hasInstructions ? "cursor-pointer hover:bg-zinc-800/30" : ""
                }`}
                onClick={() =>
                  hasInstructions &&
                  setExpandedInstr(isExpanded ? null : iterNum)
                }
              >
                <span className="text-xs font-mono text-zinc-500 w-10">
                  iter {iterNum}
                </span>

                {selectEvt?.selected_candidate != null && (
                  <span className="text-xs text-zinc-400">
                    parent <span className="font-mono text-zinc-300">#{selectEvt.selected_candidate}</span>
                  </span>
                )}

                {/* Status badge */}
                {wasAccepted && (
                  <span className="text-xs px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                    accepted → #{acceptedEvt.new_program_idx}
                  </span>
                )}
                {wasRejected && (
                  <span className="text-xs px-1.5 py-0.5 rounded bg-red-500/10 text-red-400/70 border border-red-500/20">
                    rejected
                  </span>
                )}
                {isEvaluating && (
                  <span className="text-xs px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-400 border border-blue-500/30">
                    full valset eval...
                  </span>
                )}
                {wasSkipped && (
                  <span className="text-xs px-1.5 py-0.5 rounded bg-zinc-700/50 text-zinc-500">
                    skipped
                  </span>
                )}
                {!wasAccepted && !wasRejected && !isEvaluating && !wasSkipped && beforeEvt && (
                  <span className="text-xs px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-400 border border-blue-500/30">
                    in progress...
                  </span>
                )}

                {/* Scores */}
                {beforeEvt?.subsample_score != null && afterEvt?.new_subsample_score != null && (
                  <span className="text-xs text-zinc-500">
                    {beforeEvt.subsample_score.toFixed(0)}
                    <span className="text-zinc-600 mx-1">→</span>
                    <span className={
                      afterEvt.new_subsample_score > beforeEvt.subsample_score
                        ? "text-emerald-400"
                        : "text-red-400"
                    }>
                      {afterEvt.new_subsample_score.toFixed(0)}
                    </span>
                    <span className="text-zinc-600"> / minibatch</span>
                  </span>
                )}

                {acceptedEvt?.best_score != null && (
                  <span className="text-xs text-zinc-400">
                    best: {(acceptedEvt.best_score * 100).toFixed(1)}%
                  </span>
                )}

                <span className="text-xs text-zinc-600 ml-auto">
                  @{events[events.length - 1]?.total_metric_calls ?? "?"} calls
                </span>

                {hasInstructions && (
                  <span className="text-zinc-600 text-xs">
                    {isExpanded ? "▲" : "▼"}
                  </span>
                )}
              </div>

              {/* Detail — reason for skip/reject */}
              {wasSkipped && (
                <div className="px-3 pb-2 text-xs text-zinc-600">
                  Minibatch scored perfectly — no failures to learn from, skipping reflection.
                </div>
              )}
              {isEvaluating && (
                <div className="px-3 pb-2 text-xs text-blue-400/60">
                  Minibatch improved ({beforeEvt?.subsample_score?.toFixed(0)} → {afterEvt?.new_subsample_score?.toFixed(0)}). Running full valset evaluation...
                  {afterEvt?.total_metric_calls != null && totalMetricCalls > afterEvt.total_metric_calls && (
                    <span className="ml-2 text-blue-300">
                      ({totalMetricCalls - afterEvt.total_metric_calls}{valsetSize ? ` / ${valsetSize}` : ""} evaluated)
                    </span>
                  )}
                </div>
              )}
              {!wasAccepted && !wasRejected && !isEvaluating && !wasSkipped && beforeEvt && (
                <div className="px-3 pb-2 text-xs text-blue-400/60">
                  Waiting for reflection LM response...
                </div>
              )}
              {wasRejected && !isExpanded && (
                <div className="px-3 pb-2 text-xs text-zinc-600">
                  Proposed instruction scored {afterEvt?.new_subsample_score?.toFixed(0) ?? "?"} on the minibatch
                  {beforeEvt?.subsample_score != null && (<> (parent scored {beforeEvt.subsample_score.toFixed(0)})</>)}
                  {" "}— GEPA requires strict improvement to accept.
                  {hasInstructions && " Click to see the rejected instruction."}
                </div>
              )}
              {wasAccepted && !isExpanded && hasInstructions && (
                <div className="px-3 pb-2 text-xs text-zinc-500">
                  Click to see the accepted instruction.
                </div>
              )}

              {/* Expanded instruction */}
              {isExpanded && hasInstructions && (
                <div className="px-3 pb-3 border-t border-zinc-800/50">
                  <div className="text-xs text-zinc-500 mt-2 mb-1">
                    Proposed instruction {wasAccepted ? "(accepted)" : wasRejected ? "(rejected)" : ""}
                  </div>
                  {Object.entries(instructions).map(([name, text]) => (
                    <pre
                      key={name}
                      className="text-xs text-zinc-300 bg-[#09090b] rounded-lg p-3 border border-zinc-800 whitespace-pre-wrap break-words max-h-64 overflow-y-auto mt-1"
                    >
                      {text as string}
                    </pre>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// --- Main views ---

function RunDetail({ runId, onBack }: { runId: string; onBack: () => void; }) {
  const [data, setData] = useState<{
    run: Run;
    calls: CallGroup[];
    recentCalls: RecentCall[];
    candidates: Candidate[];
    metricTimeline: MetricBucket[];
    paretoSummary: ParetoEntry[];
    recentMetricCalls: MetricCall[];
    iterations: Iteration[];
    totalMetricCalls: number;
  } | null>(null);
  const [viewCall, setViewCall] = useState<RecentCall | null>(null);
  const [activeSection, setActiveSection] = useState<
    "optimization" | "llm"
  >("optimization");

  useEffect(() => {
    let alive = true;

    const poll = () => {
      fetch(`/api/gepa?run_id=${runId}`)
        .then((r) => r.json())
        .then((d) => {
          if (!alive) return;
          setData(d);
          // Keep polling while run is still running
          if (d.run?.status === "running") {
            setTimeout(poll, 3000);
          }
        });
    };
    poll();

    return () => { alive = false; };
  }, [runId]);

  if (!data) return <div className="text-zinc-500">Loading...</div>;
  const { run, calls, recentCalls, candidates, metricTimeline, paretoSummary, recentMetricCalls, iterations } =
    data;

  const hasGepaData =
    candidates.length > 0 || metricTimeline.length > 0 || (iterations && iterations.length > 0);

  return (
    <div className="space-y-6">
      <button
        onClick={onBack}
        className="text-sm text-zinc-400 hover:text-white transition"
      >
        &larr; Back to runs
      </button>

      <div className="flex items-center gap-3">
        <h2 className="text-lg font-semibold">{run.name || run.run_id}</h2>
        <StatusBadge status={run.status} />
        <span className="text-xs text-zinc-500 font-mono">{run.run_id}</span>
      </div>

      <div className="grid grid-cols-6 gap-4">
        {[
          { label: "Solver", value: run.solver },
          { label: "Auto", value: run.auto },
          { label: "Started", value: formatTime(run.started_at) },
          {
            label: "Duration",
            value: run.finished_at
              ? formatDuration(run.finished_at - run.started_at)
              : "running...",
          },
          {
            label: "Cost",
            value: formatCost(
              calls.reduce((s: number, c: CallGroup) => s + (c.cost_usd || 0), 0)
            ),
          },
          {
            label: "Avg Response",
            value: (() => {
              const totalCalls = calls.reduce((s: number, c: CallGroup) => s + c.calls, 0);
              const totalTime = calls.reduce((s: number, c: CallGroup) => s + (c.duration_secs || 0), 0);
              return totalCalls > 0 ? `${(totalTime / totalCalls).toFixed(1)}s` : "—";
            })(),
          },
        ].map((s) => (
          <div
            key={s.label}
            className="bg-zinc-900 border border-zinc-800 rounded-lg p-3"
          >
            <div className="text-xs text-zinc-500">{s.label}</div>
            <div className="text-sm font-medium mt-1">{s.value}</div>
          </div>
        ))}
      </div>

      {/* Section tabs */}
      {hasGepaData && (
        <div className="flex gap-1 bg-[#18181b] rounded-lg p-1 border border-[#27272a] w-fit">
          {(
            [
              ["optimization", "Optimization"],
              ["llm", "LLM Calls"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setActiveSection(key)}
              className={`px-3 py-1.5 text-sm rounded-md transition-all ${
                activeSection === key
                  ? "bg-[#6366f1] text-white font-medium"
                  : "text-[#a1a1aa] hover:text-white hover:bg-[#27272a]"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {/* Optimization section */}
      {activeSection === "optimization" && hasGepaData && (
        <div className="space-y-6">
          {/* Accuracy chart */}
          <AccuracyChart data={metricTimeline} />

          {/* Metric call heatmap */}
          <RecentMetricCalls data={recentMetricCalls} />

          {/* Pareto */}
          <ParetoSummary data={paretoSummary} />

          {/* Iterations timeline (real-time) */}
          <IterationsTimeline
            iterations={iterations || []}
            totalMetricCalls={data.totalMetricCalls || 0}
          />

          {/* Candidates — live from iterations if post-run data not available yet */}
          {candidates.length > 0 ? (
            <CandidatesTable
              candidates={candidates}
              paretoSummary={paretoSummary}
            />
          ) : (iterations && iterations.length > 0) ? (
            <LiveCandidates iterations={iterations} />
          ) : null}
        </div>
      )}

      {/* LLM Calls section */}
      {(activeSection === "llm" || !hasGepaData) && (
        <div className="space-y-6">
          {/* Per-model breakdown */}
          <div>
            <h3 className="text-sm font-medium text-zinc-400 mb-2">
              Model Breakdown
            </h3>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-zinc-500 border-b border-zinc-800">
                  <th className="pb-2">Model</th>
                  <th className="pb-2">Role</th>
                  <th className="pb-2 text-right">Calls</th>
                  <th className="pb-2 text-right">Prompt Tok</th>
                  <th className="pb-2 text-right">Comp Tok</th>
                  <th className="pb-2 text-right">Cost</th>
                  <th className="pb-2 text-right">Total Time</th>
                  <th className="pb-2 text-right">Avg/Call</th>
                  <th className="pb-2 text-right">Errors</th>
                </tr>
              </thead>
              <tbody>
                {calls.map((c, i) => (
                  <tr key={i} className="border-b border-zinc-800/50">
                    <td className="py-2 font-mono text-xs">{c.model}</td>
                    <td className="py-2">
                      <span
                        className={
                          c.role === "reflection"
                            ? "text-purple-400"
                            : "text-cyan-400"
                        }
                      >
                        {c.role}
                      </span>
                    </td>
                    <td className="py-2 text-right">{c.calls}</td>
                    <td className="py-2 text-right">
                      {c.prompt_tokens?.toLocaleString()}
                    </td>
                    <td className="py-2 text-right">
                      {c.completion_tokens?.toLocaleString()}
                    </td>
                    <td className="py-2 text-right">
                      {formatCost(c.cost_usd || 0)}
                    </td>
                    <td className="py-2 text-right">
                      {formatDuration(c.duration_secs || 0)}
                    </td>
                    <td className="py-2 text-right">
                      {c.calls > 0 ? `${((c.duration_secs || 0) / c.calls).toFixed(1)}s` : "—"}
                    </td>
                    <td className="py-2 text-right">
                      {c.errors > 0 ? (
                        <span className="text-red-400">{c.errors}</span>
                      ) : (
                        <span className="text-zinc-600">0</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Recent calls */}
          <div>
            <h3 className="text-sm font-medium text-zinc-400 mb-2">
              Recent Calls (last 50)
            </h3>
            <div className="space-y-1 max-h-[500px] overflow-y-auto">
              {recentCalls.map((c, i) => (
                <div
                  key={i}
                  onClick={() => setViewCall(c)}
                  className={`text-xs font-mono p-2 rounded border cursor-pointer transition-colors ${
                    c.error
                      ? "border-red-900/50 bg-red-950/20 hover:bg-red-950/30"
                      : "border-zinc-800 bg-zinc-900 hover:bg-zinc-800"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <span className="text-zinc-500">
                      {new Date(c.timestamp * 1000).toLocaleTimeString()}
                    </span>
                    <span
                      className={
                        c.role === "reflection"
                          ? "text-purple-400"
                          : "text-cyan-400"
                      }
                    >
                      {c.role}
                    </span>
                    <span className="text-zinc-400">{c.model}</span>
                    <span className="text-zinc-600 ml-auto">
                      {c.prompt_tokens}+{c.completion_tokens} tok
                    </span>
                    <span className="text-zinc-600">
                      {formatCost(c.cost_usd || 0)}
                    </span>
                    <span className="text-zinc-600">
                      {c.duration_secs?.toFixed(1)}s
                    </span>
                  </div>
                  {c.error && (
                    <div className="text-red-400 mt-1 truncate">{c.error}</div>
                  )}
                  {c.response_preview && !c.error && (
                    <div className="text-zinc-600 mt-1 truncate">
                      {c.response_preview.slice(0, 150)}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {viewCall && (
        <ResponseModal call={viewCall} onClose={() => setViewCall(null)} />
      )}
    </div>
  );
}

export default function GepaExperiments({
  initialRunId,
  onNavigate,
}: {
  initialRunId?: string;
  onNavigate?: (runId?: string) => void;
}) {
  const [runs, setRuns] = useState<Run[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [selectedRun, setSelectedRun] = useState<string | null>(
    initialRunId || null
  );

  // Sync with parent when initialRunId changes
  useEffect(() => {
    setSelectedRun(initialRunId || null);
  }, [initialRunId]);

  useEffect(() => {
    let alive = true;

    const poll = () => {
      fetch("/api/gepa")
        .then((r) => r.json())
        .then((data) => {
          if (!alive) return;
          if (data.error) setError(data.error);
          setRuns(data.runs || []);
          // Poll if any run is still running
          const hasRunning = (data.runs || []).some((r: Run) => r.status === "running");
          if (hasRunning) setTimeout(poll, 5000);
        })
        .catch((e) => { if (alive) setError(e.message); });
    };
    poll();

    return () => { alive = false; };
  }, []);

  if (selectedRun) {
    return (
      <RunDetail
        runId={selectedRun}
        onBack={() => {
          setSelectedRun(null);
          onNavigate?.();
        }}
      />
    );
  }

  if (error) {
    return (
      <div className="text-zinc-500 text-sm">
        <p>No GEPA experiment data yet.</p>
        <p className="text-xs mt-1 text-zinc-600">
          Run{" "}
          <code className="bg-zinc-800 px-1 rounded">
            python src/run_gepa.py --solver v1 --auto light
          </code>{" "}
          to start an experiment.
        </p>
        <p className="text-xs mt-1 text-zinc-700">{error}</p>
      </div>
    );
  }

  if (runs.length === 0) {
    return (
      <div className="text-zinc-500 text-sm">
        No experiments yet. Start one with{" "}
        <code className="bg-zinc-800 px-1 rounded">
          python src/run_gepa.py
        </code>
      </div>
    );
  }

  return (
    <div>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-zinc-500 border-b border-zinc-800">
            <th className="pb-2">Run</th>
            <th className="pb-2">Status</th>
            <th className="pb-2 text-right">Best Score</th>
            <th className="pb-2 text-right">Candidates</th>
            <th className="pb-2 text-right">Cost</th>
            <th className="pb-2 text-right">Duration</th>
            <th className="pb-2 pl-4">Started</th>
          </tr>
        </thead>
        <tbody>
          {runs.map((r) => (
            <tr
              key={r.run_id}
              className="border-b border-zinc-800/50 hover:bg-zinc-900/50 cursor-pointer"
              onClick={() => {
                setSelectedRun(r.run_id);
                onNavigate?.(r.run_id);
              }}
            >
              <td className="py-2">
                <div className="font-medium">{r.name || r.run_id}</div>
                <div className="text-xs text-zinc-600 font-mono">
                  {r.run_id} · {r.solver} · {r.auto}
                </div>
              </td>
              <td className="py-2">
                <StatusBadge status={r.status} />
              </td>
              <td className="py-2 text-right">
                {r.best_score != null ? (
                  <span className="text-indigo-400 font-mono">
                    {(r.best_score * 100).toFixed(1)}%
                  </span>
                ) : (
                  "—"
                )}
              </td>
              <td className="py-2 text-right">
                {r.num_candidates ?? "—"}
              </td>
              <td className="py-2 text-right">
                {formatCost(r.total_cost || 0)}
              </td>
              <td className="py-2 text-right">
                {formatDuration(r.total_duration || 0)}
              </td>
              <td className="py-2 text-xs text-zinc-500 pl-4">
                {formatTime(r.started_at)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
