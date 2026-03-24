"use client";

import { useEffect, useState, useCallback, useRef, useMemo } from "react";

// ─── Types ───────────────────────────────────────────────────────────

interface BinFile {
  run_id: string;
  size: number;
  mtime: number;
}

interface TraceEntry {
  i: number;
  selected_program_candidate: number;
  subsample_ids: number[];
  subsample_scores: number[];
  new_subsample_scores?: number[];
  new_program_idx?: number;
  evaluated_val_indices?: number;
  invoked_merge?: boolean;
}

interface ReplayData {
  num_candidates: number;
  num_iterations: number;
  total_metric_calls: number;
  num_val_instances: number;
  candidates: Record<string, string>[];
  aggregate_scores: number[];
  parents: (number | null)[][];
  discovery_calls: number[];
  val_subscores: Record<string, number>[];
  trace: TraceEntry[];
  pareto_front: Record<string, number[]>;
  pareto_scores: Record<string, number>;
  pareto_dominance: number[];
}

// ─── Helpers ─────────────────────────────────────────────────────────

function formatDate(ts: number): string {
  return new Date(ts * 1000).toLocaleString();
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

// ─── Main Component ──────────────────────────────────────────────────

export default function GepaReplay() {
  const [bins, setBins] = useState<BinFile[]>([]);
  const [selectedRun, setSelectedRun] = useState<string>("");
  const [data, setData] = useState<ReplayData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>("");

  // Animation state
  const [currentStep, setCurrentStep] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1); // seconds per step
  const [animPhase, setAnimPhase] = useState<"select" | "subsample" | "compare" | "result" | "fulleval" | "done">("select");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const phaseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load bin file list
  useEffect(() => {
    fetch("/api/gepa-replay")
      .then((r) => r.json())
      .then((d) => {
        setBins(d.bins || []);
        if (d.bins?.length > 0) setSelectedRun(d.bins[0].run_id);
      });
  }, []);

  // Load replay data when run changes
  useEffect(() => {
    if (!selectedRun) return;
    setLoading(true);
    setError("");
    setCurrentStep(0);
    setPlaying(false);
    setAnimPhase("select");
    fetch(`/api/gepa-replay?run_id=${selectedRun}`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((d) => {
        if (d.error) throw new Error(d.error);
        setData(d);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [selectedRun]);

  // Animation phases within each step
  const advancePhase = useCallback(() => {
    setAnimPhase((prev) => {
      const entry = data?.trace[currentStep];
      if (!entry) return "done";
      switch (prev) {
        case "select": return "subsample";
        case "subsample": return "compare";
        case "compare": return "result";
        case "result":
          if (entry.new_program_idx != null && entry.evaluated_val_indices) return "fulleval";
          return "done";
        case "fulleval": return "done";
        default: return "done";
      }
    });
  }, [data, currentStep]);

  // Playback logic
  useEffect(() => {
    if (!playing || !data) return;
    if (currentStep >= data.trace.length) {
      setPlaying(false);
      return;
    }

    if (animPhase === "done") {
      // Move to next iteration
      timerRef.current = setTimeout(() => {
        if (currentStep < data.trace.length - 1) {
          setCurrentStep((s) => s + 1);
          setAnimPhase("select");
        } else {
          setPlaying(false);
        }
      }, 300 / speed);
    } else {
      // Advance phase within iteration
      phaseTimerRef.current = setTimeout(advancePhase, 600 / speed);
    }

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      if (phaseTimerRef.current) clearTimeout(phaseTimerRef.current);
    };
  }, [playing, currentStep, animPhase, speed, data, advancePhase]);

  const goToStep = useCallback((step: number) => {
    if (!data) return;
    setCurrentStep(Math.max(0, Math.min(step, data.trace.length - 1)));
    setAnimPhase("done");
    setPlaying(false);
  }, [data]);

  const togglePlay = () => {
    if (!data) return;
    if (currentStep >= data.trace.length - 1 && animPhase === "done") {
      setCurrentStep(0);
      setAnimPhase("select");
      setPlaying(true);
    } else {
      if (!playing && animPhase === "done") {
        // Start next iteration
        if (currentStep < data.trace.length - 1) {
          setCurrentStep((s) => s + 1);
          setAnimPhase("select");
        }
      }
      setPlaying(!playing);
    }
  };

  // Compute state at a given step (candidates discovered so far, pareto so far)
  const stateAtStep = useMemo(() => {
    if (!data) return null;
    const entry = data.trace[currentStep];
    if (!entry) return null;

    // Which candidates exist at this point?
    const discoveredCandidates = new Set<number>();
    discoveredCandidates.add(0); // Seed always exists
    for (let s = 0; s <= currentStep; s++) {
      const e = data.trace[s];
      if (e.new_program_idx != null) discoveredCandidates.add(e.new_program_idx);
    }

    // Best score so far
    let bestScore = 0;
    let bestCandidate = 0;
    for (const idx of discoveredCandidates) {
      if (data.aggregate_scores[idx] > bestScore) {
        bestScore = data.aggregate_scores[idx];
        bestCandidate = idx;
      }
    }

    // Cumulative metric calls at this step
    const metricCalls = entry.new_program_idx != null
      ? data.discovery_calls[entry.new_program_idx] || 0
      : (currentStep > 0 ? data.discovery_calls[Math.max(...Array.from(discoveredCandidates))] : 0);

    return {
      entry,
      discoveredCandidates,
      bestScore,
      bestCandidate,
      metricCalls,
    };
  }, [data, currentStep]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-zinc-500">
        <div className="animate-spin w-6 h-6 border-2 border-zinc-600 border-t-indigo-500 rounded-full mr-3" />
        Loading GEPA state...
      </div>
    );
  }

  if (error) {
    return <div className="text-red-400 text-center py-12">{error}</div>;
  }

  return (
    <div className="space-y-4">
      {/* File Picker */}
      <div className="flex items-center gap-4 bg-[#18181b] border border-[#27272a] rounded-xl px-5 py-3">
        <label className="text-sm text-zinc-400 whitespace-nowrap">GEPA State:</label>
        <select
          value={selectedRun}
          onChange={(e) => setSelectedRun(e.target.value)}
          className="flex-1 bg-[#09090b] border border-[#27272a] rounded-lg px-3 py-1.5 text-sm text-zinc-200"
        >
          {bins.map((b) => (
            <option key={b.run_id} value={b.run_id}>
              {b.run_id} — {formatSize(b.size)} — {formatDate(b.mtime)}
            </option>
          ))}
        </select>
        {data && (
          <div className="flex gap-4 text-xs text-zinc-500">
            <span>{data.num_candidates} candidates</span>
            <span>{data.trace.length} iterations</span>
            <span>{data.total_metric_calls.toLocaleString()} evals</span>
            <span>{data.num_val_instances} val instances</span>
          </div>
        )}
      </div>

      {data && stateAtStep && (
        <>
          {/* Playback Controls */}
          <PlaybackControls
            currentStep={currentStep}
            totalSteps={data.trace.length}
            playing={playing}
            speed={speed}
            animPhase={animPhase}
            onTogglePlay={togglePlay}
            onSetSpeed={setSpeed}
            onGoToStep={goToStep}
            onStepForward={() => {
              if (currentStep < data.trace.length - 1) {
                setCurrentStep((s) => s + 1);
                setAnimPhase("done");
              }
            }}
            onStepBack={() => {
              if (currentStep > 0) {
                setCurrentStep((s) => s - 1);
                setAnimPhase("done");
              }
            }}
          />

          {/* Main animation layout */}
          <div className="grid grid-cols-12 gap-4">
            {/* Left: Candidate Tree + Iteration Detail */}
            <div className="col-span-5 space-y-4">
              <CandidateTree
                data={data}
                currentStep={currentStep}
                discoveredCandidates={stateAtStep.discoveredCandidates}
                selectedParent={stateAtStep.entry.selected_program_candidate}
                newCandidate={animPhase === "result" || animPhase === "fulleval" || animPhase === "done" ? stateAtStep.entry.new_program_idx : undefined}
                animPhase={animPhase}
              />
              <IterationDetail
                data={data}
                entry={stateAtStep.entry}
                animPhase={animPhase}
              />
            </div>

            {/* Right: Scores + Pareto */}
            <div className="col-span-7 space-y-4">
              <MinibatchView
                entry={stateAtStep.entry}
                animPhase={animPhase}
              />
              <CandidateScoreChart
                data={data}
                discoveredCandidates={stateAtStep.discoveredCandidates}
                currentNewCandidate={stateAtStep.entry.new_program_idx}
                animPhase={animPhase}
              />
            </div>
          </div>

          {/* Full Val Evaluation — instance-level comparison when candidate accepted */}
          <FullValEvaluation
            data={data}
            entry={stateAtStep.entry}
            animPhase={animPhase}
          />

          {/* All-candidates instance heatmap */}
          <CandidateInstanceHeatmap
            data={data}
            discoveredCandidates={stateAtStep.discoveredCandidates}
            highlightCandidate={stateAtStep.entry.new_program_idx}
            parentCandidate={stateAtStep.entry.selected_program_candidate}
          />

          {/* Candidate Instructions Viewer */}
          <CandidateInstructions
            data={data}
            discoveredCandidates={stateAtStep.discoveredCandidates}
            highlightCandidate={stateAtStep.entry.new_program_idx}
          />
        </>
      )}
    </div>
  );
}

// ─── Playback Controls ──────────────────────────────────────────────

function PlaybackControls({
  currentStep,
  totalSteps,
  playing,
  speed,
  animPhase,
  onTogglePlay,
  onSetSpeed,
  onGoToStep,
  onStepForward,
  onStepBack,
}: {
  currentStep: number;
  totalSteps: number;
  playing: boolean;
  speed: number;
  animPhase: string;
  onTogglePlay: () => void;
  onSetSpeed: (s: number) => void;
  onGoToStep: (s: number) => void;
  onStepForward: () => void;
  onStepBack: () => void;
}) {
  const phaseLabels: Record<string, string> = {
    select: "Selecting parent",
    subsample: "Evaluating minibatch",
    compare: "Comparing scores",
    result: "Accept / Reject",
    fulleval: "Full validation eval",
    done: "Complete",
  };

  return (
    <div className="bg-[#18181b] border border-[#27272a] rounded-xl px-5 py-3">
      <div className="flex items-center gap-3">
        {/* Step back */}
        <button
          onClick={onStepBack}
          disabled={currentStep === 0}
          className="px-2 py-1 text-sm rounded hover:bg-[#27272a] disabled:opacity-30 disabled:cursor-not-allowed"
          title="Previous iteration"
        >
          &#x23EE;
        </button>

        {/* Play/Pause */}
        <button
          onClick={onTogglePlay}
          className="px-3 py-1.5 text-sm rounded-lg bg-indigo-600 hover:bg-indigo-500 font-medium min-w-[80px]"
        >
          {playing ? "Pause" : "Play"}
        </button>

        {/* Step forward */}
        <button
          onClick={onStepForward}
          disabled={currentStep >= totalSteps - 1}
          className="px-2 py-1 text-sm rounded hover:bg-[#27272a] disabled:opacity-30 disabled:cursor-not-allowed"
          title="Next iteration"
        >
          &#x23ED;
        </button>

        {/* Timeline slider */}
        <div className="flex-1 mx-3">
          <input
            type="range"
            min={0}
            max={totalSteps - 1}
            value={currentStep}
            onChange={(e) => onGoToStep(parseInt(e.target.value))}
            className="w-full accent-indigo-500"
          />
        </div>

        {/* Step indicator */}
        <div className="text-sm text-zinc-400 min-w-[140px] text-right">
          Iteration <span className="text-white font-mono">{currentStep}</span>{" "}
          <span className="text-zinc-600">/ {totalSteps - 1}</span>
        </div>

        {/* Speed control */}
        <div className="flex items-center gap-1.5 ml-2">
          <span className="text-xs text-zinc-500">Speed:</span>
          {[0.25, 0.5, 1, 2].map((s) => (
            <button
              key={s}
              onClick={() => onSetSpeed(s)}
              className={`px-2 py-0.5 text-xs rounded ${
                speed === s
                  ? "bg-indigo-600 text-white"
                  : "bg-[#27272a] text-zinc-400 hover:text-white"
              }`}
            >
              {s < 1 ? `${s}x` : `${s}x`}
            </button>
          ))}
        </div>
      </div>

      {/* Phase indicator */}
      {playing && (
        <div className="flex items-center gap-2 mt-2 text-xs">
          <div className="w-2 h-2 rounded-full bg-indigo-500 animate-pulse" />
          <span className="text-zinc-400">{phaseLabels[animPhase] || animPhase}</span>
        </div>
      )}
    </div>
  );
}

// ─── Candidate Tree ─────────────────────────────────────────────────

function CandidateTree({
  data,
  currentStep,
  discoveredCandidates,
  selectedParent,
  newCandidate,
  animPhase,
}: {
  data: ReplayData;
  currentStep: number;
  discoveredCandidates: Set<number>;
  selectedParent: number;
  newCandidate?: number;
  animPhase: string;
}) {
  // Build tree structure
  const nodes = Array.from(discoveredCandidates).sort((a, b) => a - b);

  // Layout: assign depth levels based on parent chain
  const depths: Record<number, number> = {};
  function getDepth(idx: number): number {
    if (depths[idx] !== undefined) return depths[idx];
    const parentList = data.parents[idx];
    if (!parentList || parentList[0] == null) {
      depths[idx] = 0;
      return 0;
    }
    depths[idx] = getDepth(parentList[0]) + 1;
    return depths[idx];
  }
  nodes.forEach(getDepth);

  const maxDepth = Math.max(...nodes.map((n) => depths[n] || 0), 0);

  // Group by depth
  const byDepth: Record<number, number[]> = {};
  for (const n of nodes) {
    const d = depths[n] || 0;
    if (!byDepth[d]) byDepth[d] = [];
    byDepth[d].push(n);
  }

  // Node positions for edge drawing
  const nodeWidth = 72;
  const nodeHeight = 42;
  const levelGap = 60;
  const nodeGap = 10;

  const positions: Record<number, { x: number; y: number }> = {};
  for (let d = 0; d <= maxDepth; d++) {
    const group = byDepth[d] || [];
    const totalWidth = group.length * nodeWidth + (group.length - 1) * nodeGap;
    const startX = (500 - totalWidth) / 2; // Center in container
    group.forEach((n, i) => {
      positions[n] = {
        x: startX + i * (nodeWidth + nodeGap) + nodeWidth / 2,
        y: d * levelGap + nodeHeight / 2 + 10,
      };
    });
  }

  const svgHeight = (maxDepth + 1) * levelGap + 30;

  return (
    <div className="bg-[#18181b] border border-[#27272a] rounded-xl p-4">
      <h3 className="text-sm font-medium text-zinc-300 mb-3">Candidate Tree</h3>
      <svg width="100%" viewBox={`0 0 500 ${svgHeight}`} className="overflow-visible">
        {/* Edges */}
        {nodes.map((n) => {
          const parentList = data.parents[n];
          if (!parentList || parentList[0] == null) return null;
          const parent = parentList[0];
          if (!positions[parent] || !positions[n]) return null;
          const isNewEdge = n === newCandidate;
          return (
            <line
              key={`edge-${parent}-${n}`}
              x1={positions[parent].x}
              y1={positions[parent].y + nodeHeight / 2}
              x2={positions[n].x}
              y2={positions[n].y - nodeHeight / 2}
              stroke={isNewEdge ? "#818cf8" : "#3f3f46"}
              strokeWidth={isNewEdge ? 2 : 1}
              strokeDasharray={isNewEdge && (animPhase === "result" || animPhase === "fulleval") ? "4,4" : undefined}
              className={isNewEdge ? "transition-all duration-500" : ""}
            />
          );
        })}

        {/* Nodes */}
        {nodes.map((n) => {
          const pos = positions[n];
          if (!pos) return null;
          const isParent = n === selectedParent;
          const isNew = n === newCandidate;
          const score = data.aggregate_scores[n];
          const isBest = score === Math.max(...Array.from(discoveredCandidates).map((c) => data.aggregate_scores[c]));

          let fill = "#27272a";
          let stroke = "#3f3f46";
          let textColor = "#a1a1aa";
          if (isNew && (animPhase === "result" || animPhase === "fulleval" || animPhase === "done")) {
            fill = "#312e81";
            stroke = "#818cf8";
            textColor = "#c7d2fe";
          } else if (isParent && animPhase !== "done") {
            fill = "#1e1b4b";
            stroke = "#6366f1";
            textColor = "#c7d2fe";
          } else if (isBest) {
            fill = "#064e3b";
            stroke = "#10b981";
            textColor = "#6ee7b7";
          }

          return (
            <g key={`node-${n}`} className="transition-all duration-300">
              <rect
                x={pos.x - nodeWidth / 2}
                y={pos.y - nodeHeight / 2}
                width={nodeWidth}
                height={nodeHeight}
                rx={8}
                fill={fill}
                stroke={stroke}
                strokeWidth={isParent || isNew ? 2 : 1}
              />
              <text x={pos.x} y={pos.y - 5} textAnchor="middle" fill={textColor} fontSize={12} fontWeight={600}>
                C{n}
              </text>
              <text x={pos.x} y={pos.y + 11} textAnchor="middle" fill="#71717a" fontSize={10}>
                {(score * 100).toFixed(1)}%
              </text>
            </g>
          );
        })}
      </svg>

      <div className="flex gap-3 mt-2 text-[10px] text-zinc-600">
        <span className="flex items-center gap-1">
          <span className="w-3 h-3 rounded border-2 border-indigo-500 bg-[#1e1b4b] inline-block" /> Selected parent
        </span>
        <span className="flex items-center gap-1">
          <span className="w-3 h-3 rounded border-2 border-indigo-400 bg-[#312e81] inline-block" /> New candidate
        </span>
        <span className="flex items-center gap-1">
          <span className="w-3 h-3 rounded border-2 border-emerald-500 bg-[#064e3b] inline-block" /> Best overall
        </span>
      </div>
    </div>
  );
}

// ─── Iteration Detail Panel ─────────────────────────────────────────

function IterationDetail({
  data,
  entry,
  animPhase,
}: {
  data: ReplayData;
  entry: TraceEntry;
  animPhase: string;
}) {
  const wasAccepted = entry.new_program_idx != null;
  const parentScore = data.aggregate_scores[entry.selected_program_candidate];
  const subsampleOld = entry.subsample_scores;
  const subsampleNew = entry.new_subsample_scores;
  const oldAvg = subsampleOld.reduce((a, b) => a + b, 0) / subsampleOld.length;
  const newAvg = subsampleNew ? subsampleNew.reduce((a, b) => a + b, 0) / subsampleNew.length : 0;

  return (
    <div className="bg-[#18181b] border border-[#27272a] rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-medium text-zinc-300">
          Iteration {entry.i}
        </h3>
        <div className="flex items-center gap-2">
          {entry.invoked_merge && (
            <span className="px-2 py-0.5 text-[10px] rounded bg-purple-500/20 text-purple-400 border border-purple-500/30">
              merge
            </span>
          )}
          {(animPhase === "result" || animPhase === "fulleval" || animPhase === "done") && (
            <span
              className={`px-2 py-0.5 text-[10px] rounded border ${
                wasAccepted
                  ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/30"
                  : "bg-red-500/20 text-red-400 border-red-500/30"
              }`}
            >
              {wasAccepted ? `Accepted → C${entry.new_program_idx}` : "Rejected"}
            </span>
          )}
        </div>
      </div>

      <div className="space-y-2 text-xs">
        {/* Parent selection */}
        <div className={`transition-opacity duration-300 ${animPhase === "select" || animPhase !== "select" ? "opacity-100" : "opacity-40"}`}>
          <span className="text-zinc-500">Parent:</span>{" "}
          <span className="text-indigo-400 font-mono">C{entry.selected_program_candidate}</span>
          <span className="text-zinc-600 ml-2">({(parentScore * 100).toFixed(1)}% val)</span>
        </div>

        {/* Subsample comparison */}
        {(animPhase !== "select") && (
          <div className="mt-2">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-zinc-500">Minibatch score:</span>
              <span className="font-mono text-zinc-300">{(oldAvg * 100).toFixed(0)}%</span>
              {subsampleNew && subsampleNew.length > 0 && (
                <>
                  <span className="text-zinc-600">→</span>
                  <span className={`font-mono ${newAvg >= oldAvg ? "text-emerald-400" : "text-red-400"}`}>
                    {(newAvg * 100).toFixed(0)}%
                  </span>
                  {newAvg > oldAvg && <span className="text-emerald-500 text-[10px]">+{((newAvg - oldAvg) * 100).toFixed(0)}%</span>}
                  {newAvg < oldAvg && <span className="text-red-500 text-[10px]">{((newAvg - oldAvg) * 100).toFixed(0)}%</span>}
                </>
              )}
            </div>
          </div>
        )}

        {/* Full eval info */}
        {wasAccepted && (animPhase === "fulleval" || animPhase === "done") && (
          <div className="text-zinc-500">
            Full val eval: <span className="text-zinc-300 font-mono">{entry.evaluated_val_indices}</span> instances →{" "}
            <span className="text-emerald-400 font-mono">{(data.aggregate_scores[entry.new_program_idx!] * 100).toFixed(1)}%</span>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Minibatch View ─────────────────────────────────────────────────

function MinibatchView({
  entry,
  animPhase,
}: {
  entry: TraceEntry;
  animPhase: string;
}) {
  const showNew = animPhase !== "select" && animPhase !== "subsample";

  return (
    <div className="bg-[#18181b] border border-[#27272a] rounded-xl p-4">
      <h3 className="text-sm font-medium text-zinc-300 mb-3">
        Minibatch Evaluation
        <span className="text-zinc-600 text-xs ml-2">
          ({entry.subsample_ids.length} training examples)
        </span>
      </h3>

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-zinc-500 border-b border-[#27272a]">
              <th className="py-1.5 px-2 text-left font-normal">#</th>
              <th className="py-1.5 px-2 text-left font-normal">Train ID</th>
              <th className="py-1.5 px-2 text-center font-normal">Parent Score</th>
              {showNew && entry.new_subsample_scores && (
                <th className="py-1.5 px-2 text-center font-normal">New Score</th>
              )}
              {showNew && entry.new_subsample_scores && (
                <th className="py-1.5 px-2 text-center font-normal">Delta</th>
              )}
            </tr>
          </thead>
          <tbody>
            {entry.subsample_ids.map((id, i) => {
              const oldScore = entry.subsample_scores[i];
              const newScore = entry.new_subsample_scores?.[i];
              const delta = newScore != null ? newScore - oldScore : null;
              const appear = animPhase === "subsample" ? i < 5 || animPhase !== "subsample" : true;

              return (
                <tr
                  key={i}
                  className={`border-b border-[#27272a]/50 transition-all duration-300 ${
                    appear ? "opacity-100" : "opacity-30"
                  }`}
                >
                  <td className="py-1 px-2 text-zinc-600">{i + 1}</td>
                  <td className="py-1 px-2 font-mono text-zinc-400">{id}</td>
                  <td className="py-1 px-2 text-center">
                    <span className={`inline-block w-5 h-5 rounded text-[10px] leading-5 text-center ${
                      oldScore >= 1 ? "bg-emerald-500/20 text-emerald-400" : "bg-red-500/20 text-red-400"
                    }`}>
                      {oldScore >= 1 ? "1" : "0"}
                    </span>
                  </td>
                  {showNew && entry.new_subsample_scores && (
                    <td className="py-1 px-2 text-center">
                      {newScore != null ? (
                        <span className={`inline-block w-5 h-5 rounded text-[10px] leading-5 text-center ${
                          newScore >= 1 ? "bg-emerald-500/20 text-emerald-400" : "bg-red-500/20 text-red-400"
                        }`}>
                          {newScore >= 1 ? "1" : "0"}
                        </span>
                      ) : <span className="text-zinc-600">—</span>}
                    </td>
                  )}
                  {showNew && entry.new_subsample_scores && (
                    <td className="py-1 px-2 text-center">
                      {delta != null && delta !== 0 ? (
                        <span className={delta > 0 ? "text-emerald-400" : "text-red-400"}>
                          {delta > 0 ? "+1" : "-1"}
                        </span>
                      ) : (
                        <span className="text-zinc-700">=</span>
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Candidate Score Chart ──────────────────────────────────────────

function CandidateScoreChart({
  data,
  discoveredCandidates,
  currentNewCandidate,
  animPhase,
}: {
  data: ReplayData;
  discoveredCandidates: Set<number>;
  currentNewCandidate?: number;
  animPhase: string;
}) {
  const candidates = Array.from(discoveredCandidates).sort((a, b) => a - b);
  const maxScore = Math.max(...candidates.map((c) => data.aggregate_scores[c]));

  return (
    <div className="bg-[#18181b] border border-[#27272a] rounded-xl p-4">
      <h3 className="text-sm font-medium text-zinc-300 mb-3">Candidate Performance</h3>
      <div className="space-y-1.5">
        {candidates.map((c) => {
          const score = data.aggregate_scores[c];
          const pct = score * 100;
          const isNew = c === currentNewCandidate && (animPhase === "result" || animPhase === "fulleval");
          const isBest = score === maxScore;

          let barColor = "bg-zinc-600";
          if (isBest) barColor = "bg-emerald-500";
          else if (isNew) barColor = "bg-indigo-500";
          else if (score >= 0.8) barColor = "bg-blue-500";

          return (
            <div key={c} className="flex items-center gap-2">
              <span className={`text-xs font-mono w-7 text-right ${isNew ? "text-indigo-400" : "text-zinc-500"}`}>
                C{c}
              </span>
              <div className="flex-1 h-5 bg-[#09090b] rounded overflow-hidden relative">
                <div
                  className={`h-full ${barColor} rounded transition-all duration-500 ${
                    isNew ? "animate-pulse" : ""
                  }`}
                  style={{ width: `${pct}%` }}
                />
                <span className="absolute right-2 top-0 h-full flex items-center text-[10px] text-zinc-400">
                  {pct.toFixed(1)}%
                </span>
              </div>
              <span className="text-[10px] text-zinc-600 w-16 text-right">
                {data.discovery_calls[c]?.toLocaleString()} evals
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Full Val Evaluation (instance-level) ───────────────────────────

function FullValEvaluation({
  data,
  entry,
  animPhase,
}: {
  data: ReplayData;
  entry: TraceEntry;
  animPhase: string;
}) {
  const [filterMode, setFilterMode] = useState<"all" | "gained" | "lost" | "disagree">("disagree");
  const wasAccepted = entry.new_program_idx != null;

  const newIdx = wasAccepted ? entry.new_program_idx! : 0;
  const parentIdx = entry.selected_program_candidate;
  const newScores = wasAccepted ? (data.val_subscores[newIdx] || {}) : {};
  const parentScores = data.val_subscores[parentIdx] || {};

  // Compute instance-level diff
  const allKeys = Object.keys(wasAccepted ? newScores : parentScores).sort((a, b) => Number(a) - Number(b));
  const gained: string[] = [];
  const lost: string[] = [];
  const bothCorrect: string[] = [];
  const bothWrong: string[] = [];

  if (wasAccepted) {
    for (const k of allKeys) {
      const pScore = parentScores[k] ?? 0;
      const nScore = newScores[k] ?? 0;
      if (nScore >= 1 && pScore < 1) gained.push(k);
      else if (nScore < 1 && pScore >= 1) lost.push(k);
      else if (nScore >= 1 && pScore >= 1) bothCorrect.push(k);
      else bothWrong.push(k);
    }
  }

  const filteredKeys = filterMode === "all" ? allKeys
    : filterMode === "gained" ? gained
    : filterMode === "lost" ? lost
    : [...gained, ...lost];

  const newTotal = wasAccepted ? Object.values(newScores).filter((v) => v >= 1).length : 0;
  const parentTotal = Object.values(parentScores).filter((v) => v >= 1).length;

  return (
    <div className="bg-[#18181b] border border-[#27272a] rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-medium text-zinc-300">
          Full Validation Evaluation
          {wasAccepted ? (
            <span className="text-zinc-600 text-xs ml-2">C{parentIdx} → C{newIdx}</span>
          ) : (
            <span className="text-zinc-600 text-xs ml-2">from C{parentIdx}</span>
          )}
        </h3>
        {wasAccepted ? (
          <div className="flex items-center gap-3 text-xs">
            <span className="text-zinc-500">
              Parent: <span className="text-zinc-300 font-mono">{parentTotal}/{allKeys.length}</span>
            </span>
            <span className="text-zinc-600">→</span>
            <span className="text-zinc-500">
              New: <span className={`font-mono ${newTotal > parentTotal ? "text-emerald-400" : newTotal < parentTotal ? "text-red-400" : "text-zinc-300"}`}>
                {newTotal}/{allKeys.length}
              </span>
            </span>
            <span className={`font-mono text-xs ${newTotal - parentTotal > 0 ? "text-emerald-500" : newTotal - parentTotal < 0 ? "text-red-500" : "text-zinc-600"}`}>
              ({newTotal - parentTotal > 0 ? "+" : ""}{newTotal - parentTotal})
            </span>
          </div>
        ) : (
          <span className="px-2 py-0.5 text-[10px] rounded border bg-red-500/20 text-red-400 border-red-500/30">
            Rejected — no full eval
          </span>
        )}
      </div>

      {/* Fixed-height content area so components below never shift */}
      <div className="h-[340px] flex flex-col">
        {!wasAccepted ? (
          <div className="flex-1 flex items-center justify-center text-xs text-zinc-600">
            Candidate was rejected at minibatch stage — no full evaluation performed.
          </div>
        ) : (
          <>
            {/* Summary badges */}
            <div className="flex gap-2 mb-3 shrink-0">
              <button
                onClick={() => setFilterMode("disagree")}
                className={`px-2.5 py-1 text-xs rounded-lg border transition-colors ${
                  filterMode === "disagree" ? "bg-indigo-500/20 text-indigo-300 border-indigo-500/40" : "border-[#27272a] text-zinc-500 hover:text-zinc-300"
                }`}
              >
                Disagreements ({gained.length + lost.length})
              </button>
              <button
                onClick={() => setFilterMode("gained")}
                className={`px-2.5 py-1 text-xs rounded-lg border transition-colors ${
                  filterMode === "gained" ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/40" : "border-[#27272a] text-zinc-500 hover:text-zinc-300"
                }`}
              >
                Gained ({gained.length})
              </button>
              <button
                onClick={() => setFilterMode("lost")}
                className={`px-2.5 py-1 text-xs rounded-lg border transition-colors ${
                  filterMode === "lost" ? "bg-red-500/20 text-red-300 border-red-500/40" : "border-[#27272a] text-zinc-500 hover:text-zinc-300"
                }`}
              >
                Lost ({lost.length})
              </button>
              <button
                onClick={() => setFilterMode("all")}
                className={`px-2.5 py-1 text-xs rounded-lg border transition-colors ${
                  filterMode === "all" ? "bg-zinc-700 text-zinc-200 border-zinc-600" : "border-[#27272a] text-zinc-500 hover:text-zinc-300"
                }`}
              >
                All ({allKeys.length})
              </button>
              <div className="flex-1" />
              <div className="flex items-center gap-3 text-[10px] text-zinc-600">
                <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-emerald-500/40 inline-block" /> both correct ({bothCorrect.length})</span>
                <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-red-500/40 inline-block" /> both wrong ({bothWrong.length})</span>
              </div>
            </div>

            {/* Instance grid — compact pixel view for "all", table for filtered */}
            <div className="flex-1 min-h-0">
              {filterMode === "all" ? (
                <InstancePixelGrid
                  allKeys={allKeys}
                  parentScores={parentScores}
                  newScores={newScores}
                />
              ) : (
                <div className="h-full overflow-y-auto">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-[#18181b]">
                      <tr className="text-zinc-500 border-b border-[#27272a]">
                        <th className="py-1.5 px-2 text-left font-normal w-20">Val idx</th>
                        <th className="py-1.5 px-2 text-center font-normal">C{parentIdx}</th>
                        <th className="py-1.5 px-2 text-center font-normal">C{newIdx}</th>
                        <th className="py-1.5 px-2 text-center font-normal">Change</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredKeys.map((k) => {
                        const pScore = parentScores[k] ?? 0;
                        const nScore = newScores[k] ?? 0;
                        const isGained = nScore >= 1 && pScore < 1;
                        const isLost = nScore < 1 && pScore >= 1;
                        return (
                          <tr key={k} className="border-b border-[#27272a]/50">
                            <td className="py-1 px-2 font-mono text-zinc-400">{k}</td>
                            <td className="py-1 px-2 text-center">
                              <span className={`inline-block w-5 h-5 rounded text-[10px] leading-5 text-center ${
                                pScore >= 1 ? "bg-emerald-500/20 text-emerald-400" : "bg-red-500/20 text-red-400"
                              }`}>
                                {pScore >= 1 ? "1" : "0"}
                              </span>
                            </td>
                            <td className="py-1 px-2 text-center">
                              <span className={`inline-block w-5 h-5 rounded text-[10px] leading-5 text-center ${
                                nScore >= 1 ? "bg-emerald-500/20 text-emerald-400" : "bg-red-500/20 text-red-400"
                              }`}>
                                {nScore >= 1 ? "1" : "0"}
                              </span>
                            </td>
                            <td className="py-1 px-2 text-center">
                              {isGained && <span className="text-emerald-400 font-medium">+1 gained</span>}
                              {isLost && <span className="text-red-400 font-medium">-1 lost</span>}
                              {!isGained && !isLost && <span className="text-zinc-700">=</span>}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// Compact pixel grid showing all val instances at once
function InstancePixelGrid({
  allKeys,
  parentScores,
  newScores,
}: {
  allKeys: string[];
  parentScores: Record<string, number>;
  newScores: Record<string, number>;
}) {
  // Each instance = one pixel/cell showing: gained (green), lost (red), both correct (dim green), both wrong (dim red)
  return (
    <div>
      <div className="flex items-center gap-2 mb-2 text-[10px] text-zinc-500">
        <span>Parent C → New C per instance:</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-emerald-400 inline-block" /> gained</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-red-400 inline-block" /> lost</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-emerald-900 inline-block" /> both correct</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-red-900 inline-block" /> both wrong</span>
      </div>
      <div className="flex flex-wrap gap-[2px]">
        {allKeys.map((k) => {
          const p = (parentScores[k] ?? 0) >= 1;
          const n = (newScores[k] ?? 0) >= 1;
          let color = "bg-red-900"; // both wrong
          if (n && !p) color = "bg-emerald-400"; // gained
          else if (!n && p) color = "bg-red-400"; // lost
          else if (n && p) color = "bg-emerald-900"; // both correct
          return (
            <div
              key={k}
              className={`w-[6px] h-[6px] rounded-[1px] ${color}`}
              title={`val_idx ${k}: parent=${p ? 1 : 0} new=${n ? 1 : 0}`}
            />
          );
        })}
      </div>
    </div>
  );
}

// ─── Candidate Instance Heatmap ─────────────────────────────────────

function CandidateInstanceHeatmap({
  data,
  discoveredCandidates,
  highlightCandidate,
  parentCandidate,
}: {
  data: ReplayData;
  discoveredCandidates: Set<number>;
  highlightCandidate?: number;
  parentCandidate: number;
}) {
  const [hoveredInstance, setHoveredInstance] = useState<string | null>(null);
  const [showOnlyDisagreements, setShowOnlyDisagreements] = useState(true);

  const candidates = Array.from(discoveredCandidates).sort((a, b) => a - b);
  const allKeys = Object.keys(data.val_subscores[0] || {}).sort((a, b) => Number(a) - Number(b));

  // Find instances where candidates disagree
  const disagreementKeys = useMemo(() => {
    return allKeys.filter((k) => {
      const scores = candidates.map((c) => (data.val_subscores[c]?.[k] ?? 0) >= 1 ? 1 : 0);
      return scores.some((s) => s !== scores[0]);
    });
  }, [allKeys, candidates, data.val_subscores]);

  const displayKeys = showOnlyDisagreements ? disagreementKeys : allKeys;

  // Sort instances by "hardness" — fewer candidates got it right = harder
  const sortedKeys = useMemo(() => {
    return [...displayKeys].sort((a, b) => {
      const aCorrect = candidates.filter((c) => (data.val_subscores[c]?.[a] ?? 0) >= 1).length;
      const bCorrect = candidates.filter((c) => (data.val_subscores[c]?.[b] ?? 0) >= 1).length;
      return aCorrect - bCorrect;
    });
  }, [displayKeys, candidates, data.val_subscores]);

  return (
    <div className="bg-[#18181b] border border-[#27272a] rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-medium text-zinc-300">
          Candidate x Instance Heatmap
          <span className="text-zinc-600 text-xs ml-2">
            ({candidates.length} candidates x {displayKeys.length} instances)
          </span>
        </h3>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowOnlyDisagreements(!showOnlyDisagreements)}
            className={`px-2.5 py-1 text-xs rounded-lg border transition-colors ${
              showOnlyDisagreements
                ? "bg-indigo-500/20 text-indigo-300 border-indigo-500/40"
                : "border-[#27272a] text-zinc-500 hover:text-zinc-300"
            }`}
          >
            {showOnlyDisagreements ? `Disagreements only (${disagreementKeys.length})` : `All instances (${allKeys.length})`}
          </button>
        </div>
      </div>

      <div className="overflow-x-auto">
        <div className="min-w-fit">
          {/* Rows = candidates */}
          {candidates.map((c) => {
            const scores = data.val_subscores[c] || {};
            const isHighlight = c === highlightCandidate;
            const isParent = c === parentCandidate;
            return (
              <div key={c} className="flex items-center">
                <div className={`w-12 shrink-0 text-[10px] font-mono pr-1 text-right ${
                  isHighlight ? "text-indigo-400" : isParent ? "text-purple-400" : "text-zinc-600"
                }`}>
                  C{c}
                </div>
                <div className="flex gap-[1px]">
                  {sortedKeys.map((k) => {
                    const correct = (scores[k] ?? 0) >= 1;
                    return (
                      <div
                        key={k}
                        className={`w-[5px] h-[12px] rounded-[1px] cursor-pointer transition-opacity ${
                          correct ? "bg-emerald-500" : "bg-red-500/50"
                        } ${hoveredInstance === k ? "opacity-100 ring-1 ring-white" : "opacity-70 hover:opacity-100"}`}
                        onMouseEnter={() => setHoveredInstance(k)}
                        onMouseLeave={() => setHoveredInstance(null)}
                      />
                    );
                  })}
                </div>
                <div className="ml-2 text-[10px] text-zinc-600 font-mono whitespace-nowrap">
                  {Object.values(scores).filter((v) => v >= 1).length}/{Object.keys(scores).length}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Hover detail — fixed height below the grid so it never causes layout shift */}
      <div className="h-7 mt-2">
        {hoveredInstance ? (
          <div className="text-xs text-zinc-400 bg-[#09090b] rounded px-3 py-1.5 border border-[#27272a]">
            <span className="text-zinc-500">Instance {hoveredInstance}:</span>{" "}
            {candidates.map((c) => {
              const score = (data.val_subscores[c]?.[hoveredInstance] ?? 0) >= 1;
              return (
                <span key={c} className={`mx-1 font-mono ${score ? "text-emerald-400" : "text-red-400"}`}>
                  C{c}={score ? "1" : "0"}
                </span>
              );
            })}
          </div>
        ) : (
          <div className="text-[10px] text-zinc-600 px-3 py-1.5">Hover an instance column to see per-candidate scores</div>
        )}
      </div>
    </div>
  );
}

// ─── Candidate Instructions Viewer ──────────────────────────────────

function CandidateInstructions({
  data,
  discoveredCandidates,
  highlightCandidate,
}: {
  data: ReplayData;
  discoveredCandidates: Set<number>;
  highlightCandidate?: number;
}) {
  const [expanded, setExpanded] = useState<number | null>(null);
  const candidates = Array.from(discoveredCandidates).sort((a, b) => a - b);

  return (
    <div className="bg-[#18181b] border border-[#27272a] rounded-xl p-4">
      <h3 className="text-sm font-medium text-zinc-300 mb-3">Candidate Instructions</h3>
      <div className="space-y-1">
        {candidates.map((c) => {
          const instructions = data.candidates[c];
          const isHighlighted = c === highlightCandidate;
          const isExpanded = expanded === c;
          const score = data.aggregate_scores[c];
          const parent = data.parents[c]?.[0];

          return (
            <div key={c}>
              <button
                onClick={() => setExpanded(isExpanded ? null : c)}
                className={`w-full text-left px-3 py-2 rounded-lg text-xs flex items-center gap-3 transition-colors ${
                  isHighlighted
                    ? "bg-indigo-500/10 border border-indigo-500/30"
                    : "hover:bg-[#27272a] border border-transparent"
                }`}
              >
                <span className="font-mono text-zinc-400 w-7">C{c}</span>
                <span className={`font-mono ${score >= 0.85 ? "text-emerald-400" : score >= 0.8 ? "text-blue-400" : "text-zinc-400"}`}>
                  {(score * 100).toFixed(1)}%
                </span>
                <span className="text-zinc-600">
                  {parent != null ? `← C${parent}` : "seed"}
                </span>
                <span className="text-zinc-600 ml-auto">{isExpanded ? "▾" : "▸"}</span>
              </button>
              {isExpanded && instructions && (
                <div className="ml-10 mt-1 mb-2">
                  {Object.entries(instructions).map(([name, text]) => (
                    <div key={name} className="mb-2">
                      <div className="text-[10px] text-zinc-500 mb-1">{name}</div>
                      <pre className="text-[11px] text-zinc-400 bg-[#09090b] rounded-lg p-3 border border-[#27272a] whitespace-pre-wrap break-words max-h-[300px] overflow-y-auto">
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
