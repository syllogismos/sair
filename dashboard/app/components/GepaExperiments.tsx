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
  val_size?: number;
  train_size?: number;
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
      className={`px-2 py-0.5 text-xs rounded border ${colors[status] || "bg-[#1e1e24] text-zinc-400 border-zinc-600"}`}
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
      className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-2 sm:p-6"
      onClick={onClose}
    >
      <div
        className="replay-panel max-w-[95vw] sm:max-w-3xl w-full max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-3 sm:px-6 py-4 border-b border-[#1e1e24]">
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
          <div className="px-3 sm:px-6 py-3 bg-red-950/20 border-b border-red-900/30">
            <div className="text-xs text-red-400 font-mono">{call.error}</div>
          </div>
        )}
        <div className="flex-1 overflow-y-auto px-3 sm:px-6 py-4 space-y-4">
          {call.prompt_full && (
            <div>
              <div className="text-xs text-zinc-500 mb-1">Prompt</div>
              <pre className="text-xs text-zinc-400 bg-[#0c0c0f] rounded-lg p-4 border border-[#1e1e24] whitespace-pre-wrap break-words max-h-[30vh] overflow-y-auto">
                {call.prompt_full}
              </pre>
            </div>
          )}
          <div>
            <div className="text-xs text-zinc-500 mb-1">Response</div>
            <div className="text-sm bg-[#0c0c0f] rounded-lg p-4 border border-[#1e1e24] prose prose-invert prose-sm max-w-none [&_.katex]:text-[#e2e8f0] [&_p]:text-[#d4d4d8] [&_li]:text-[#d4d4d8] [&_code]:text-[#a78bfa] [&_code]:bg-[#1e1e24] [&_code]:px-1 [&_code]:rounded">
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

function AccuracyChart({ data, totalMetricCalls, valSize }: { data: MetricBucket[]; totalMetricCalls?: number; valSize?: number | null }) {
  const [hovered, setHovered] = useState<number | null>(null);

  if (data.length === 0) return null;

  const W = 700;
  const H = 200;
  const PAD = { top: 20, right: 20, bottom: 40, left: 45 };
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
      <div className="flex items-baseline gap-3 mb-2 flex-wrap">
        <h3 className="text-[11px] font-semibold tracking-[0.08em] uppercase text-zinc-500">
          Evaluation Accuracy Over Time
        </h3>
        {(totalMetricCalls != null || valSize != null) && (
          <span className="text-[10px] text-zinc-600 font-mono">
            {totalMetricCalls != null && <>{totalMetricCalls} metric calls</>}
            {valSize != null && <> · {valSize} val examples</>}
          </span>
        )}
      </div>
      <div className="replay-panel p-3 relative">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ maxHeight: 220 }}>
          {yTicks.map((t) => (
            <g key={t}>
              <line
                x1={PAD.left} y1={yScale(t)}
                x2={W - PAD.right} y2={yScale(t)}
                stroke="#1e1e24" strokeWidth={1}
              />
              <text
                x={PAD.left - 6} y={yScale(t) + 4}
                textAnchor="end" className="fill-zinc-500" fontSize={10}
              >
                {(t * 100).toFixed(0)}%
              </text>
            </g>
          ))}

          {/* X axis ticks */}
          {(() => {
            const step = Math.max(1, Math.ceil(maxX / 200) * 50);
            const ticks = [];
            for (let v = step; v < maxX; v += step) ticks.push(v);
            return ticks.map((v) => (
              <g key={`x-${v}`}>
                <line
                  x1={xScale(v)} y1={PAD.top + plotH}
                  x2={xScale(v)} y2={PAD.top + plotH + 4}
                  stroke="#3f3f46" strokeWidth={1}
                />
                <text
                  x={xScale(v)} y={H - 6}
                  textAnchor="middle" className="fill-zinc-500" fontSize={9}
                >
                  {v}
                </text>
              </g>
            ));
          })()}
          <text
            x={PAD.left + plotW / 2} y={H - 4}
            textAnchor="middle" className="fill-zinc-600" fontSize={8}
          >
            metric calls
          </text>

          <path d={areaPath} fill="url(#accuracyGrad)" opacity={0.3} />

          <polyline
            points={polyline} fill="none"
            stroke="#0ea5e9" strokeWidth={2} strokeLinejoin="round"
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
              fill={hovered === i ? "#38bdf8" : "#0ea5e9"}
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
              stroke="#0ea5e9"
              strokeWidth={1}
              strokeDasharray="3,3"
              opacity={0.4}
              className="pointer-events-none"
            />
          )}

          <defs>
            <linearGradient id="accuracyGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#0ea5e9" stopOpacity={0.4} />
              <stop offset="100%" stopColor="#0ea5e9" stopOpacity={0} />
            </linearGradient>
          </defs>
        </svg>

        {/* Hover tooltip */}
        {hoveredData && (
          <div className="absolute top-2 right-3 bg-[#0c0c0f] border border-[#1e1e24] rounded-lg px-3 py-2 text-xs pointer-events-none">
            <div className="text-zinc-400">
              Calls {hoveredData.bucket_start}–{hoveredData.bucket_start + 19}
            </div>
            <div className="text-sky-400 font-medium text-sm">
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
      <h3 className="text-[11px] font-semibold tracking-[0.08em] uppercase text-zinc-500 mb-2">
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
                  ? "border-sky-500/30 bg-sky-950/15"
                  : "border-[#1e1e24] bg-[#141417]"
              }`}
            >
              <div
                className="flex items-center flex-wrap gap-3 px-2 sm:px-4 py-2.5 cursor-pointer hover:bg-white/[0.02] transition-colors"
                onClick={() =>
                  setExpanded(isExpanded ? null : c.candidate_idx)
                }
              >
                <span className="text-xs font-mono text-zinc-500 w-6">
                  #{c.candidate_idx}
                </span>

                {/* Score bar */}
                <div className="flex items-center gap-2 w-24 sm:w-32">
                  <div className="flex-1 h-2 bg-[#1e1e24] rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full ${
                        isBest ? "bg-emerald-500" : "bg-[#1e1e24]"
                      }`}
                      style={{ width: `${(c.val_score * 100).toFixed(1)}%` }}
                    />
                  </div>
                  <span
                    className={`text-xs font-mono ${
                      isBest ? "text-sky-400 font-medium" : "text-zinc-400"
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
                  <span className="text-xs px-1.5 py-0.5 rounded bg-sky-950/50 text-sky-400 border border-sky-800/40">
                    Best
                  </span>
                )}

                <span className="text-zinc-600 text-xs">
                  {isExpanded ? "▲" : "▼"}
                </span>
              </div>

              {isExpanded && (
                <div className="px-2 sm:px-4 pb-3 border-t border-[#1e1e24]/50">
                  {Object.entries(instructions).map(([name, text]) => (
                    <div key={name} className="mt-2">
                      <div className="text-xs text-zinc-500 mb-1">
                        {name}
                      </div>
                      <pre className="text-xs text-zinc-300 bg-[#0c0c0f] rounded-lg p-3 border border-[#1e1e24] whitespace-pre-wrap break-words max-h-64 overflow-y-auto">
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

function ParetoSummary({ data, valSize }: { data: ParetoEntry[]; valSize: number | null }) {
  if (data.length === 0) return null;

  const counts = data.map((d) => d.frontier_count);
  const maxCount = Math.max(...counts);

  return (
    <div>
      <h3 className="text-[11px] font-semibold tracking-[0.08em] uppercase text-zinc-500 mb-2">
        Pareto Frontier
      </h3>
      <div className="replay-panel p-3 sm:p-4 overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-[10px] uppercase tracking-wider text-zinc-600 border-b border-[#1e1e24]">
              <th className="pb-2 pr-4 font-normal">Candidate</th>
              <th className="pb-2 text-right font-normal">Best on</th>
              <th className="pb-2 pl-4 font-normal">Coverage</th>
            </tr>
          </thead>
          <tbody>
            {data.map((d) => (
              <tr key={d.candidate_idx} className="border-b border-[#1e1e24]/50">
                <td className="py-1.5 pr-4 font-mono text-zinc-300">
                  #{d.candidate_idx}
                </td>
                <td className="py-1.5 text-right text-zinc-400">
                  {d.frontier_count}{valSize ? ` / ${valSize}` : ""}
                </td>
                <td className="py-1.5 pl-4">
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-2 bg-[#1e1e24] rounded-full overflow-hidden max-w-[200px]">
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
      <h3 className="text-[11px] font-semibold tracking-[0.08em] uppercase text-zinc-500 mb-2">
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
      <div className="flex items-center gap-4 mt-2 text-xs text-zinc-600 flex-wrap">
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
        <div className="mt-3 bg-[#0c0c0f] border border-[#1e1e24] rounded-lg p-3 sm:p-4 text-sm">
          <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
            <div className="flex items-center gap-3 flex-wrap">
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
              <pre className="text-xs text-zinc-300 bg-[#0c0c0f] rounded-lg p-3 border border-[#1e1e24] whitespace-pre-wrap break-words max-h-48 overflow-y-auto">
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
      <h3 className="text-[11px] font-semibold tracking-[0.08em] uppercase text-zinc-500 mb-2">
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
                  ? "border-sky-500/30 bg-sky-950/15"
                  : "border-[#1e1e24] bg-[#141417]"
              }`}
            >
              <div
                className={`flex items-center flex-wrap gap-3 px-2 sm:px-4 py-2.5 ${
                  hasInstructions
                    ? "cursor-pointer hover:bg-white/[0.02]"
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
                  <div className="flex items-center gap-2 w-24 sm:w-32">
                    <div className="flex-1 h-2 bg-[#1e1e24] rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full ${
                          isBest ? "bg-emerald-500" : "bg-[#1e1e24]"
                        }`}
                        style={{
                          width: `${(c.bestScore * 100).toFixed(1)}%`,
                        }}
                      />
                    </div>
                    <span
                      className={`text-xs font-mono ${
                        isBest
                          ? "text-sky-400 font-medium"
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
                  <span className="text-xs px-1.5 py-0.5 rounded bg-sky-950/50 text-sky-400 border border-sky-800/40">
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
                <div className="px-2 sm:px-4 pb-3 border-t border-[#1e1e24]/50">
                  {Object.entries(c.instructions).map(([name, text]) => (
                    <div key={name} className="mt-2">
                      <div className="text-xs text-zinc-500 mb-1">
                        {name}
                      </div>
                      <pre className="text-xs text-zinc-300 bg-[#0c0c0f] rounded-lg p-3 border border-[#1e1e24] whitespace-pre-wrap break-words max-h-64 overflow-y-auto">
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

function IterationsTimeline({ iterations, totalMetricCalls, valSize, runFinished }: { iterations: Iteration[]; totalMetricCalls: number; valSize: number | null; runFinished?: boolean; }) {
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
      <h3 className="text-[11px] font-semibold tracking-[0.08em] uppercase text-zinc-500 mb-2">
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

          const seedEvt = events.find((e) => e.event === "seed_instruction");
          if (baseEvt || seedEvt || (iterNum === 0 && !selectEvt)) {
            return (
              <div
                key={iterNum}
                className="border border-[#1e1e24] rounded-lg p-3 bg-[#141417]"
              >
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-mono text-zinc-500">
                    iter {iterNum}
                  </span>
                  {baseEvt ? (
                    <span className="text-xs px-1.5 py-0.5 rounded bg-[#1e1e24] text-zinc-300">
                      Base evaluation
                    </span>
                  ) : (
                    <span className="text-xs px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-400 border border-blue-500/30">
                      Base evaluation in progress...
                    </span>
                  )}
                  {baseEvt?.best_score != null && (
                    <span className="text-xs text-zinc-400 ml-auto">
                      score: {((baseEvt.best_score) * 100).toFixed(1)}%
                    </span>
                  )}
                  {!baseEvt && totalMetricCalls > 0 && (
                    <span className="text-xs text-blue-300 ml-auto">
                      {totalMetricCalls}{valSize ? ` / ${valSize}` : ""} evaluated
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
                    ? "border-[#1e1e24] bg-[#141417]"
                    : "border-[#1e1e24]/50 bg-[#141417]/50"
              }`}
            >
              {/* Header — always visible */}
              <div
                className={`flex items-center gap-2 flex-wrap p-3 ${
                  hasInstructions ? "cursor-pointer hover:bg-white/[0.02]" : ""
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
                  <span className="text-xs px-1.5 py-0.5 rounded bg-[#1e1e24]/50 text-zinc-500">
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
                  {wasAccepted && acceptedEvt?.total_metric_calls != null && (
                    <span>budget used so far: {acceptedEvt.total_metric_calls}</span>
                  )}
                  {wasRejected && afterEvt?.total_metric_calls != null && (
                    <span>budget used so far: {afterEvt.total_metric_calls}</span>
                  )}
                  {wasSkipped && selectEvt?.total_metric_calls != null && (
                    <span>budget used so far: {selectEvt.total_metric_calls}</span>
                  )}
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
                  Minibatch ({selectEvt?.total_metric_calls != null && beforeEvt?.total_metric_calls != null
                    ? `${beforeEvt.total_metric_calls - selectEvt.total_metric_calls} problems`
                    : ""}): parent scored {beforeEvt?.subsample_score?.toFixed(0)}, new instruction scored {afterEvt?.new_subsample_score?.toFixed(0)} — improved. Running full valset evaluation...
                  {afterEvt?.total_metric_calls != null && totalMetricCalls > afterEvt.total_metric_calls && (
                    <span className="ml-2 text-blue-300">
                      ({Math.min(totalMetricCalls - afterEvt.total_metric_calls, valSize || totalMetricCalls)}{valSize ? ` / ${valSize}` : ""} evaluated)
                    </span>
                  )}
                </div>
              )}
              {!wasAccepted && !wasRejected && !isEvaluating && !wasSkipped && beforeEvt && (
                <div className="px-3 pb-2 text-xs text-blue-400/60">
                  Minibatch ({selectEvt?.total_metric_calls != null && beforeEvt?.total_metric_calls != null
                    ? `${beforeEvt.total_metric_calls - selectEvt.total_metric_calls} problems`
                    : ""}): parent scored {beforeEvt?.subsample_score?.toFixed(0)}. Waiting for reflection LM response...
                </div>
              )}
              {wasRejected && !isExpanded && (
                <div className="px-3 pb-2 text-xs text-zinc-600">
                  Minibatch ({selectEvt?.total_metric_calls != null && beforeEvt?.total_metric_calls != null
                    ? `${beforeEvt.total_metric_calls - selectEvt.total_metric_calls} problems`
                    : ""}): parent scored {beforeEvt?.subsample_score?.toFixed(0) ?? "?"}, new instruction scored {afterEvt?.new_subsample_score?.toFixed(0) ?? "?"} — not better, rejected.
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
                <div className="px-3 pb-3 border-t border-[#1e1e24]/50">
                  <div className="text-xs text-zinc-500 mt-2 mb-1">
                    Proposed instruction {wasAccepted ? "(accepted)" : wasRejected ? "(rejected)" : ""}
                  </div>
                  {Object.entries(instructions).map(([name, text]) => (
                    <pre
                      key={name}
                      className="text-xs text-zinc-300 bg-[#0c0c0f] rounded-lg p-3 border border-[#1e1e24] whitespace-pre-wrap break-words max-h-64 overflow-y-auto mt-1"
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

      <div className="flex items-center gap-3 flex-wrap">
        <h2 className="text-lg font-semibold">{run.name || run.run_id}</h2>
        <StatusBadge status={run.status} />
        <span className="text-xs text-zinc-500 font-mono break-all">{run.run_id}</span>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-4">
        {[
          { label: "Solver", value: run.solver },
          { label: "Auto", value: run.auto },
          { label: "Train", value: run.train_size != null ? String(run.train_size) : "—" },
          { label: "Val", value: run.val_size != null ? String(run.val_size) : "—" },
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
            className="replay-panel p-3"
          >
            <div className="text-[9px] text-zinc-600 uppercase tracking-wider">{s.label}</div>
            <div className="text-sm font-medium mt-1 text-zinc-200">{s.value}</div>
          </div>
        ))}
      </div>

      {/* Section tabs */}
      {hasGepaData && (
        <div className="flex gap-1 bg-[#0c0c0f] rounded-lg p-1 border border-[#1e1e24] w-fit">
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
                  ? "bg-sky-900/60 text-sky-300 font-medium shadow-[0_0_8px_rgba(56,189,248,0.15)]"
                  : "text-zinc-600 hover:text-zinc-300 hover:bg-white/[0.02]"
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
          <AccuracyChart
            data={metricTimeline}
            totalMetricCalls={data.totalMetricCalls}
            valSize={
              (run as Run).val_size ||
              iterations?.find((it: Iteration) => it.event === "base_eval")?.total_metric_calls ||
              null
            }
          />

          {/* Metric call heatmap */}
          <RecentMetricCalls data={recentMetricCalls} />

          {/* Pareto */}
          <ParetoSummary
            data={paretoSummary}
            valSize={
              (run as Run).val_size ||
              iterations?.find((it: Iteration) => it.event === "base_eval")?.total_metric_calls ||
              null
            }
          />

          {/* Iterations timeline (real-time) */}
          <IterationsTimeline
            iterations={iterations || []}
            totalMetricCalls={data.totalMetricCalls || 0}
            valSize={
              (run as Run).val_size ||
              iterations?.find((it: Iteration) => it.event === "base_eval")?.total_metric_calls ||
              null
            }
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
            <h3 className="text-[11px] font-semibold tracking-[0.08em] uppercase text-zinc-500 mb-2">
              Model Breakdown
            </h3>
            <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wider text-zinc-600 border-b border-[#1e1e24]">
                  <th className="pb-2 font-normal">Model</th>
                  <th className="pb-2 font-normal">Role</th>
                  <th className="pb-2 text-right font-normal">Calls</th>
                  <th className="pb-2 text-right font-normal">Prompt Tok</th>
                  <th className="pb-2 text-right font-normal">Comp Tok</th>
                  <th className="pb-2 text-right font-normal">Cost</th>
                  <th className="pb-2 text-right font-normal">Total Time</th>
                  <th className="pb-2 text-right font-normal">Avg/Call</th>
                  <th className="pb-2 text-right font-normal">Errors</th>
                </tr>
              </thead>
              <tbody>
                {calls.map((c, i) => (
                  <tr key={i} className="border-b border-[#1e1e24]/50">
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
          </div>

          {/* Recent calls */}
          <div>
            <h3 className="text-[11px] font-semibold tracking-[0.08em] uppercase text-zinc-500 mb-2">
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
                      : "border-[#1e1e24] bg-[#141417] hover:bg-white/[0.03]"
                  }`}
                >
                  <div className="flex items-center gap-3 flex-wrap">
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
          <code className="bg-[#1e1e24] px-1 rounded">
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
        <code className="bg-[#1e1e24] px-1 rounded">
          python src/run_gepa.py
        </code>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-[10px] uppercase tracking-wider text-zinc-600 border-b border-[#1e1e24]">
            <th className="pb-2 font-normal">Run</th>
            <th className="pb-2 font-normal">Status</th>
            <th className="pb-2 text-right font-normal">Score</th>
            <th className="pb-2 text-right font-normal">#</th>
            <th className="pb-2 text-right font-normal">Cost</th>
            <th className="pb-2 text-right font-normal hidden sm:table-cell">Duration</th>
            <th className="pb-2 pl-4 font-normal hidden sm:table-cell">Started</th>
          </tr>
        </thead>
        <tbody>
          {runs.map((r) => (
            <tr
              key={r.run_id}
              className="border-b border-[#1e1e24]/50 hover:bg-white/[0.01] cursor-pointer transition-colors"
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
                  <span className="text-sky-400 font-mono">
                    {(r.best_score * 100).toFixed(1)}%
                  </span>
                ) : (
                  "—"
                )}
              </td>
              <td className="py-2 text-right">
                {r.num_candidates ?? "—"}
              </td>
              <td className="py-2 text-right whitespace-nowrap">
                {formatCost(r.total_cost || 0)}
              </td>
              <td className="py-2 text-right hidden sm:table-cell">
                {formatDuration(r.total_duration || 0)}
              </td>
              <td className="py-2 text-xs text-zinc-500 pl-4 hidden sm:table-cell">
                {formatTime(r.started_at)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
